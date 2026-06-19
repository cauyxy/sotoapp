// Legacy dictation transcription contract used inside the engine adapter.
// The live session boundary is ModelRuntime; these types stay in capabilities
// so engine.ts can reuse the pre-runtime omni / ASR+LLM implementation without
// importing domain code — dependency-cruiser forbids capabilities → domain.

import type { AxContext } from "../../contract/schema.js";
import type { AppProfile } from "../context/appProfile.js";

/**
 * Everything an engine needs to assemble its own dictation prompts (engine spec
 * §5): prompt assembly is engine-specific, so it moves below this port. The
 * EngineSpec wiring stays pure provider plumbing.
 */
export interface TranscriptionRequest {
  modePrompt: string;
  hotwords: readonly string[];
  axContext: AxContext | null;
  appProfile?: AppProfile;
  audio: { audioB64: string; audioFormat: string };
}

/**
 * The transcription outcome. `rawText` is the recognition, `finalText` the
 * (possibly post-processed) text — Omni sets both to the same string.
 * `providerId`/`modelId` snapshot the RECOGNITION source's resolved config so
 * persisted history reflects the real chosen provider/model (Rust parity:
 * ProviderResponse.provider_id = config.provider_id, model_id = config.model);
 * `modelId` may be null when the provider has no model concept.
 */
export interface TranscriptionResult {
  rawText: string;
  finalText: string;
  providerId: string;
  modelId: string | null;
  /** LLM hop provenance — set only when the LLM hop actually ran (asr_llm). */
  llmProviderId?: string | null;
  llmModelId?: string | null;
}

export interface TranscriptionPort {
  respond(request: TranscriptionRequest): Promise<TranscriptionResult>;
}
