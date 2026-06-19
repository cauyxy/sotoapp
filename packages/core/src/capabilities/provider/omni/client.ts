// Omni HTTP transport — the thin networking wrapper around the pure
// request/response logic. Port of soto_provider's ChatCompletionsOmni. The
// fetch implementation is injected (the Electron main process passes an
// undici-backed fetch; tests pass a fake), so this layer is unit-testable with
// no real network. Pure shaping/parsing/error-mapping is reused from
// request.ts / response.ts.

import {
  buildResponseRequest,
  buildValidationRequest,
  validateConfig,
  type OmniConfig,
} from "./request.js";
import { createResponseException, parseOmniResponse } from "./response.js";

/** Structural multipart body (web FormData) so core never names DOM types. */
export interface MultipartBody {
  append(name: string, value: unknown, fileName?: string): void;
}

/** Minimal fetch shape used by the client (a subset of the WHATWG fetch). */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string | MultipartBody;
    signal?: AbortSignal;
  },
) => Promise<{ status: number; text: () => Promise<string> }>;

/** Matches soto_provider DEFAULT_HTTP_TIMEOUT (30s). */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export interface OmniClientOptions {
  fetch: FetchLike;
  timeoutMs?: number;
}

export interface RespondRequest {
  config: OmniConfig;
  systemPrompt: string;
  userPrompt: string;
  audioB64: string;
  audioFormat: string;
}

/** POST a chat-completions body with bearer auth; non-2xx maps to ProviderException. */
export async function postChatCompletions(
  fetchFn: FetchLike,
  normalized: OmniConfig,
  body: unknown,
  timeoutMs: number,
): Promise<string> {
  const url = `${normalized.baseUrl}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${normalized.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (response.status < 200 || response.status >= 300) {
      throw createResponseException(response.status, raw);
    }
    return raw;
  } finally {
    clearTimeout(timer);
  }
}

export class OmniClient {
  private readonly fetch: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: OmniClientOptions) {
    this.fetch = options.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  /** Run speech recognition; returns the model's final text. */
  async respond(request: RespondRequest): Promise<string> {
    const normalized = validateConfig(request.config);
    const body = buildResponseRequest(
      normalized,
      request.systemPrompt,
      request.userPrompt,
      request.audioB64,
      request.audioFormat,
    );
    const raw = await postChatCompletions(this.fetch, normalized, body, this.timeoutMs);
    return parseOmniResponse(raw);
  }

  /** Validate a provider config with a lightweight "reply ok" round-trip. */
  async validate(config: OmniConfig): Promise<void> {
    const normalized = validateConfig(config);
    const body = buildValidationRequest(normalized);
    await postChatCompletions(this.fetch, normalized, body, this.timeoutMs);
  }
}
