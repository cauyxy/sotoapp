// DashScope Qwen Realtime ASR adapter. It preserves the existing one-shot AsrPort
// contract by streaming an already-finished 16 kHz mono PCM16 WAV over a
// per-request WebSocket, then resolving with the final input-transcription text.

import { DEFAULT_REQUEST_TIMEOUT_MS } from "../omni/client.js";
import { ProviderException } from "../omni/errors.js";
import type { WebSocketFactory, WebSocketLike } from "../realtime/socket.js";
import { base64ToBytes, type AsrClientConfig } from "./openaiCompatAsr.js";
import type { AsrHints, AsrPort } from "./port.js";

export const DASHSCOPE_REALTIME_CHUNK_BYTES = 3200;
export const DASHSCOPE_REALTIME_AUDIO_FORMAT = "pcm";

interface DashscopeRealtimeDeps {
  webSocket?: WebSocketFactory;
  timeoutMs?: number;
}

interface Pcm16WavPayload {
  pcm: Uint8Array;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  audioFormat: number;
}

type RealtimeEvent = {
  type?: unknown;
  delta?: unknown;
  transcript?: unknown;
  text?: unknown;
  error?: {
    message?: unknown;
    code?: unknown;
  };
};

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[offset + i] ?? 0);
  return out;
}

function assertChunkBounds(bytes: Uint8Array, offset: number, size: number): void {
  if (offset + size > bytes.length) {
    throw new ProviderException("invalid_configuration", "WAV payload has a truncated chunk.");
  }
}

export function parsePcm16Mono16kWav(bytes: Uint8Array): Pcm16WavPayload {
  if (bytes.length < 12 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") {
    throw new ProviderException(
      "invalid_configuration",
      "Qwen Realtime ASR requires a RIFF/WAVE audio payload.",
    );
  }

  let offset = 12;
  let fmt: Omit<Pcm16WavPayload, "pcm"> | null = null;
  let pcm: Uint8Array | null = null;

  while (offset + 8 <= bytes.length) {
    const id = ascii(bytes, offset, 4);
    const size = new DataView(bytes.buffer, bytes.byteOffset + offset + 4, 4).getUint32(0, true);
    const dataOffset = offset + 8;
    assertChunkBounds(bytes, dataOffset, size);

    if (id === "fmt ") {
      if (size < 16) {
        throw new ProviderException("invalid_configuration", "WAV fmt chunk is too short.");
      }
      const view = new DataView(bytes.buffer, bytes.byteOffset + dataOffset, size);
      fmt = {
        audioFormat: view.getUint16(0, true),
        channels: view.getUint16(2, true),
        sampleRate: view.getUint32(4, true),
        bitsPerSample: view.getUint16(14, true),
      };
    } else if (id === "data") {
      pcm = bytes.subarray(dataOffset, dataOffset + size);
    }

    offset = dataOffset + size + (size % 2);
  }

  if (fmt === null) {
    throw new ProviderException("invalid_configuration", "WAV payload is missing a fmt chunk.");
  }
  if (pcm === null) {
    throw new ProviderException("invalid_configuration", "WAV payload is missing a data chunk.");
  }
  if (
    fmt.audioFormat !== 1 ||
    fmt.sampleRate !== 16_000 ||
    fmt.channels !== 1 ||
    fmt.bitsPerSample !== 16
  ) {
    throw new ProviderException(
      "invalid_configuration",
      "Qwen Realtime ASR requires 16 kHz mono PCM16 WAV audio.",
    );
  }
  return { ...fmt, pcm };
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    const CHUNK = 0x8000;
    let binary = "";
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }
  return Buffer.from(bytes).toString("base64");
}

function realtimeUrl(baseUrl: string, model: string): string {
  try {
    const url = new URL(baseUrl);
    url.searchParams.set("model", model);
    return url.toString();
  } catch {
    throw new ProviderException("invalid_configuration", "Qwen Realtime base URL is invalid.");
  }
}

function parseRealtimeEvent(raw: string): RealtimeEvent {
  try {
    return JSON.parse(raw) as RealtimeEvent;
  } catch {
    throw new ProviderException("request_failed", "Qwen Realtime event JSON could not be parsed.");
  }
}

function providerErrorMessage(event: RealtimeEvent): string {
  const message = event.error?.message;
  const code = event.error?.code;
  if (typeof message === "string" && message.trim().length > 0) {
    return `Qwen Realtime error: ${message.trim()}`;
  }
  if (typeof code === "string" && code.trim().length > 0) {
    return `Qwen Realtime error: ${code.trim()}`;
  }
  return "Qwen Realtime returned an error event.";
}

function requiresResponseCreate(model: string): boolean {
  return model.startsWith("qwen3.5-omni-");
}

function sendJson(ws: WebSocketLike, value: unknown): void {
  ws.send(JSON.stringify(value));
}

function sessionUpdateFor(config: AsrClientConfig, hints: AsrHints): Record<string, unknown> {
  const hotwords = hints.hotwords.map((word) => word.trim()).filter((word) => word.length > 0);
  const session: Record<string, unknown> = {
    modalities: ["text"],
    input_audio_format: DASHSCOPE_REALTIME_AUDIO_FORMAT,
    input_audio_transcription: { model: config.model },
    turn_detection: null,
  };
  if (hotwords.length > 0) {
    session.instructions = `Bias transcription toward these terms: ${hotwords.join(", ")}`;
  }
  return { type: "session.update", session };
}

function streamAudio(ws: WebSocketLike, pcm: Uint8Array, model: string): void {
  for (let offset = 0; offset < pcm.length; offset += DASHSCOPE_REALTIME_CHUNK_BYTES) {
    const chunk = pcm.subarray(offset, offset + DASHSCOPE_REALTIME_CHUNK_BYTES);
    sendJson(ws, { type: "input_audio_buffer.append", audio: bytesToBase64(chunk) });
  }
  sendJson(ws, { type: "input_audio_buffer.commit" });
  if (requiresResponseCreate(model)) {
    sendJson(ws, { type: "response.create", response: { modalities: ["text"] } });
  }
}

function closeQuietly(ws: WebSocketLike): void {
  try {
    ws.close();
  } catch {
    // Best effort cleanup; the caller has already settled.
  }
}

export function createDashscopeRealtimeAsr(
  config: AsrClientConfig,
  deps: DashscopeRealtimeDeps,
): AsrPort {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  return {
    async transcribe(audio, hints): Promise<{ text: string }> {
      if (deps.webSocket === undefined) {
        throw new ProviderException(
          "invalid_configuration",
          "Qwen Realtime ASR requires a WebSocket transport.",
        );
      }
      if (audio.audioFormat.toLowerCase() !== "wav") {
        throw new ProviderException(
          "invalid_configuration",
          "Qwen Realtime ASR requires WAV audio input.",
        );
      }

      const { pcm } = parsePcm16Mono16kWav(base64ToBytes(audio.audioB64));
      const ws = deps.webSocket(realtimeUrl(config.baseUrl, config.model), {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "OpenAI-Beta": "realtime=v1",
        },
      });

      return await new Promise<{ text: string }>((resolve, reject) => {
        let settled = false;
        let transcript = "";
        const timer = setTimeout(() => {
          settleReject(
            new ProviderException(
              "request_failed",
              `Qwen Realtime ASR timed out after ${timeoutMs}ms.`,
            ),
          );
        }, timeoutMs);

        const settleResolve = (text: string): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          closeQuietly(ws);
          resolve({ text: text.trim() });
        };

        const settleReject = (err: ProviderException): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          closeQuietly(ws);
          reject(err);
        };

        ws.on("message", (raw) => {
          let event: RealtimeEvent;
          try {
            event = parseRealtimeEvent(raw);
          } catch (error) {
            settleReject(error as ProviderException);
            return;
          }
          const type = typeof event.type === "string" ? event.type : "";
          if (type === "session.created") {
            sendJson(ws, sessionUpdateFor(config, hints));
            return;
          }
          if (type === "session.updated") {
            streamAudio(ws, pcm, config.model);
            return;
          }
          if (type === "conversation.item.input_audio_transcription.delta") {
            if (typeof event.delta === "string") transcript += event.delta;
            return;
          }
          if (type === "conversation.item.input_audio_transcription.completed") {
            const completed =
              typeof event.transcript === "string"
                ? event.transcript
                : typeof event.text === "string"
                  ? event.text
                  : transcript;
            settleResolve(completed);
            return;
          }
          if (type === "response.done" && requiresResponseCreate(config.model)) {
            settleResolve(transcript);
            return;
          }
          if (type === "error") {
            settleReject(new ProviderException("request_failed", providerErrorMessage(event)));
          }
        });

        ws.on("error", (err) => {
          settleReject(new ProviderException("request_failed", `Qwen Realtime socket error: ${err.message}`));
        });

        ws.on("close", (code, reason) => {
          if (settled) return;
          const suffix = reason.length > 0 ? `: ${reason}` : "";
          settleReject(
            new ProviderException(
              "request_failed",
              `Qwen Realtime socket closed before transcription completed (${code})${suffix}`,
            ),
          );
        });
      });
    },
  };
}
