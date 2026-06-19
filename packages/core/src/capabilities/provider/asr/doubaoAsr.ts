// Volcano Engine 录音文件识别极速版 (flash) adapter (engine spec §3.2/§4.1).
// JSON body with inline base64 audio; authenticates with the App Key /
// Access Key pair stored as "AppKey:AccessKey" in the single api_key column
// (split on the FIRST ':'; the convention never surfaces in the UI).
// Success = HTTP 2xx AND (no X-Api-Status-Code header logic — flash returns
// errors as non-2xx or an error JSON body; an empty result text is VALID).

import { ProviderException } from "../omni/errors.js";
import { createResponseException } from "../omni/response.js";
import { DEFAULT_REQUEST_TIMEOUT_MS, type FetchLike } from "../omni/client.js";
import type { AsrHints, AsrPort } from "./port.js";
import type { AsrClientConfig } from "./openaiCompatAsr.js";

export const DOUBAO_FLASH_ASR_PATH = "/api/v3/auc/bigmodel/recognize/flash";
export const DOUBAO_FLASH_RESOURCE_ID = "volc.bigasr.auc_turbo";

/** Split the stored "AppKey:AccessKey" pair on the FIRST colon. */
export function splitDoubaoKeys(apiKey: string): { appKey: string; accessKey: string } {
  const idx = apiKey.indexOf(":");
  if (idx <= 0 || idx === apiKey.length - 1) {
    throw new ProviderException(
      "invalid_configuration",
      "Doubao ASR credentials must be stored as AppKey:AccessKey.",
    );
  }
  return { appKey: apiKey.slice(0, idx), accessKey: apiKey.slice(idx + 1) };
}

function parseFlashResponse(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProviderException("request_failed", "ASR response JSON could not be parsed.");
  }
  const text = (parsed as { result?: { text?: unknown } }).result?.text;
  return typeof text === "string" ? text.trim() : "";
}

export function createDoubaoAsr(
  config: AsrClientConfig,
  deps: { fetch: FetchLike; timeoutMs?: number; requestId?: () => string },
): AsrPort {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const requestId = deps.requestId ?? (() => `soto-${Date.now()}-${Math.floor(Math.random() * 1e9)}`);
  return {
    async transcribe(audio, hints: AsrHints): Promise<{ text: string }> {
      const { appKey, accessKey } = splitDoubaoKeys(config.apiKey);
      const body = {
        user: { uid: "soto" },
        audio: { format: audio.audioFormat, data: audio.audioB64 },
        request: {
          model_name: config.model,
          enable_itn: true,
          enable_punc: true,
          ...(hints.hotwords.length > 0
            ? {
                corpus: {
                  context: JSON.stringify({
                    hotwords: hints.hotwords.map((word) => ({ word })),
                  }),
                },
              }
            : {}),
        },
      };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await deps.fetch(
          `${config.baseUrl.replace(/\/+$/u, "")}${DOUBAO_FLASH_ASR_PATH}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Api-App-Key": appKey,
              "X-Api-Access-Key": accessKey,
              "X-Api-Resource-Id": DOUBAO_FLASH_RESOURCE_ID,
              "X-Api-Request-Id": requestId(),
              "X-Api-Sequence": "-1",
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          },
        );
        const raw = await response.text();
        if (response.status < 200 || response.status >= 300) {
          throw createResponseException(response.status, raw);
        }
        return { text: parseFlashResponse(raw) };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
