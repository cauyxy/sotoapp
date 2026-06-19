// OpenAI-compatible transcriptions adapter (engine spec §4.1): multipart
// POST {base}/audio/transcriptions with file/model/language/prompt fields.
// Hotwords ride the `prompt` parameter (whisper-style biasing). Covers
// OpenAI/Groq/SiliconFlow and future local whisper servers. Empty transcripts
// are VALID (the silent validation WAV must pass on HTTP 2xx).

import { ProviderException } from "../omni/errors.js";
import { createResponseException } from "../omni/response.js";
import { DEFAULT_REQUEST_TIMEOUT_MS, type FetchLike, type MultipartBody } from "../omni/client.js";
import type { AsrHints, AsrPort } from "./port.js";

export interface AsrClientConfig {
  providerId: string;
  apiKey: string;
  model: string;
  baseUrl: string;
}

const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Module-level 256-entry lookup table: charCode → 6-bit value, 255 = invalid.
const BASE64_LOOKUP = new Uint8Array(256).fill(255);
for (let i = 0; i < BASE64_CHARS.length; i++) {
  BASE64_LOOKUP[BASE64_CHARS.charCodeAt(i)] = i;
}

/** Pure base64 → bytes (no Buffer/atob dependency). */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[=\s]+$/u, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (let i = 0; i < clean.length; i++) {
    const value = BASE64_LOOKUP[clean.charCodeAt(i)] ?? 255;
    if (value === 255) {
      throw new ProviderException("invalid_configuration", "Audio payload is not valid base64.");
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (buffer >> bits) & 0xff;
    }
  }
  return out.subarray(0, index);
}

function parseTranscriptionResponse(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProviderException("request_failed", "ASR response JSON could not be parsed.");
  }
  const text = (parsed as { text?: unknown }).text;
  return typeof text === "string" ? text.trim() : "";
}

export function createOpenAiCompatAsr(
  config: AsrClientConfig,
  deps: { fetch: FetchLike; timeoutMs?: number },
): AsrPort {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  return {
    async transcribe(audio, hints: AsrHints): Promise<{ text: string }> {
      const runtime = globalThis as {
        FormData?: new () => MultipartBody;
        Blob?: new (parts: unknown[], opts?: { type?: string }) => unknown;
      };
      if (typeof runtime.FormData !== "function" || typeof runtime.Blob !== "function") {
        throw new ProviderException(
          "invalid_configuration",
          "Multipart upload is unavailable in this runtime (FormData/Blob missing).",
        );
      }
      const form = new runtime.FormData();
      const bytes = base64ToBytes(audio.audioB64);
      const blob = new runtime.Blob([bytes], { type: `audio/${audio.audioFormat}` });
      form.append("file", blob, `audio.${audio.audioFormat}`);
      form.append("model", config.model);
      if (hints.languageHint !== null && hints.languageHint.trim().length > 0) {
        form.append("language", hints.languageHint.trim());
      }
      if (hints.hotwords.length > 0) {
        form.append("prompt", hints.hotwords.join("、"));
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await deps.fetch(
          `${config.baseUrl.replace(/\/+$/u, "")}/audio/transcriptions`,
          {
            method: "POST",
            // No Content-Type: the runtime fetch sets the multipart boundary.
            headers: { Authorization: `Bearer ${config.apiKey}` },
            body: form,
            signal: controller.signal,
          },
        );
        const raw = await response.text();
        if (response.status < 200 || response.status >= 300) {
          throw createResponseException(response.status, raw);
        }
        return { text: parseTranscriptionResponse(raw) };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
