// Text-only chat-completions client — the LLM hop of the ASR + LLM engine.
// Consumes the shared skeleton extracted from provider/omni/: request
// shaping (buildTextRequest), transport (postChatCompletions), and response
// parsing/error mapping (parseOmniResponse/createResponseException).

import { type RequestProfile } from "../catalog.js";
import { DEFAULT_REQUEST_TIMEOUT_MS, postChatCompletions, type FetchLike } from "../omni/client.js";
import { buildTextRequest, type OmniConfig } from "../omni/request.js";
import { parseOmniResponse } from "../omni/response.js";
import type { LlmPort } from "./port.js";

export interface LlmClientConfig {
  providerId: string;
  apiKey: string;
  model: string;
  baseUrl: string;
  requestProfile: RequestProfile;
}

export function createLlmPort(
  config: LlmClientConfig,
  deps: { fetch: FetchLike; timeoutMs?: number },
): LlmPort {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const normalized: OmniConfig = {
    providerId: config.providerId,
    apiKey: config.apiKey,
    model: config.model,
    baseUrl: config.baseUrl,
  };
  return {
    async complete(systemPrompt: string, userPrompt: string): Promise<string> {
      const body = buildTextRequest(normalized, config.requestProfile, systemPrompt, userPrompt);
      const raw = await postChatCompletions(deps.fetch, normalized, body, timeoutMs);
      return parseOmniResponse(raw);
    },
  };
}

/** Lightweight "reply ok" validation round trip for llm-capability configs.
 * The empty system prompt emits a single user message (see buildTextRequest). */
export async function validateLlmConfig(
  config: LlmClientConfig,
  deps: { fetch: FetchLike; timeoutMs?: number },
): Promise<void> {
  const port = createLlmPort(config, deps);
  await port.complete("", 'Reply with the single word "ok".');
}
