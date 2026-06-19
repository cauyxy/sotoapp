// Engine factory (engine spec §4.3): compose ModelRuntime adapters from an
// EngineSpec. Dictation still reuses the legacy TranscriptionPort internally.
// No silent fallback: a required-LLM failure rejects (§2).

import { OmniClient, type FetchLike } from "../provider/omni/client.js";
import { audioFormatFor } from "../provider/omni/request.js";
import {
  buildPolishPrompt,
  buildVoicePrompt,
} from "../prompts/voicePrompt.js";
import { createLlmPort } from "../provider/llm/client.js";
import { createOpenAiCompatAsr } from "../provider/asr/openaiCompatAsr.js";
import { createDoubaoAsr } from "../provider/asr/doubaoAsr.js";
import { createDashscopeRealtimeAsr } from "../provider/asr/dashscopeRealtimeAsr.js";
import { ProviderException } from "../provider/omni/errors.js";
import type { WebSocketFactory } from "../provider/realtime/socket.js";
import type { AsrPort } from "../provider/asr/port.js";
import type {
  TranscriptionPort,
  TranscriptionRequest,
  TranscriptionResult,
} from "./port.js";
import type { EngineSpec, ResolvedProviderConfig } from "./spec.js";
import type {
  ModelInput,
  ModelInputContextBlock,
  ModelIntent,
  ModelOutput,
} from "../model-input/modelInput.js";
import type {
  ModelRuntime,
} from "./runtime.js";

export interface EngineDeps {
  fetch: FetchLike;
  webSocket?: WebSocketFactory;
  timeoutMs?: number;
}

export type ResolvedModelCapability = "omni" | "asr_llm";

export function resolveCapability(
  _intent: ModelIntent,
  spec: EngineSpec,
): ResolvedModelCapability {
  return spec.kind;
}

function contextBlock<K extends ModelInputContextBlock["kind"]>(
  input: ModelInput,
  kind: K,
): Extract<ModelInputContextBlock, { kind: K }> | undefined {
  return input.contextBlocks.find(
    (block): block is Extract<ModelInputContextBlock, { kind: K }> =>
      block.kind === kind,
  );
}

function transcriptionRequestFromModelInput(input: ModelInput): TranscriptionRequest {
  if (input.audio === null) {
    throw new ProviderException(
      "invalid_configuration",
      "Dictation model input requires audio.",
    );
  }
  const appProfile = contextBlock(input, "app_profile")?.profile;
  return {
    modePrompt: input.mode.prompt,
    hotwords: input.hotwords,
    axContext: contextBlock(input, "target_context")?.axContext ?? null,
    ...(appProfile !== undefined ? { appProfile } : {}),
    audio: input.audio,
  };
}

function outputFromTranscription(result: TranscriptionResult): ModelOutput {
  return {
    rawText: result.rawText,
    finalText: result.finalText,
    providerTrace: {
      recognitionProviderId: result.providerId,
      recognitionModelId: result.modelId,
      llmProviderId: result.llmProviderId ?? null,
      llmModelId: result.llmModelId ?? null,
    },
  };
}

/**
 * Select the ASR adapter for a resolved asr-capability config. Exported so
 * per-capability validation (main) picks the adapter exactly the way the
 * engine does.
 */
export function createAsrPort(config: ResolvedProviderConfig, deps: EngineDeps): AsrPort {
  const clientConfig = {
    providerId: config.providerId,
    apiKey: config.apiKey,
    model: config.model,
    baseUrl: config.baseUrl,
  };
  switch (config.requestProfile) {
    case "openai_transcriptions":
      return createOpenAiCompatAsr(clientConfig, deps);
    case "doubao_flash_asr":
      return createDoubaoAsr(clientConfig, deps);
    case "dashscope_realtime":
      if (deps.webSocket === undefined) {
        throw new ProviderException(
          "invalid_configuration",
          "Qwen Realtime ASR requires a WebSocket transport.",
        );
      }
      return createDashscopeRealtimeAsr(clientConfig, deps);
    default:
      throw new ProviderException(
        "invalid_configuration",
        `Provider '${config.providerId}' has no ASR request profile.`,
      );
  }
}

export function createEngineTranscription(spec: EngineSpec, deps: EngineDeps): TranscriptionPort {
  if (spec.kind === "omni") {
    const client = new OmniClient({
      fetch: deps.fetch,
      ...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}),
    });
    return {
      async respond(request: TranscriptionRequest): Promise<TranscriptionResult> {
        const prompt = buildVoicePrompt(
          request.modePrompt,
          request.hotwords,
          request.axContext,
          request.appProfile === undefined ? {} : { appProfile: request.appProfile },
        );
        const text = await client.respond({
          config: {
            providerId: spec.config.providerId,
            apiKey: spec.config.apiKey,
            model: spec.config.model,
            baseUrl: spec.config.baseUrl,
          },
          systemPrompt: prompt.systemPrompt,
          userPrompt: prompt.userPrompt,
          audioB64: request.audio.audioB64,
          audioFormat: audioFormatFor(request.audio.audioFormat),
        });
        return {
          rawText: text,
          finalText: text,
          providerId: spec.config.providerId,
          modelId: spec.config.model,
        };
      },
    };
  }

  const asr = createAsrPort(spec.asr, deps);
  const llm = createLlmPort(
    {
      providerId: spec.llm.providerId,
      apiKey: spec.llm.apiKey,
      model: spec.llm.model,
      baseUrl: spec.llm.baseUrl,
      requestProfile: spec.llm.requestProfile,
    },
    deps,
  );

  return {
    async respond(request: TranscriptionRequest): Promise<TranscriptionResult> {
      const { text: rawText } = await asr.transcribe(request.audio, {
        hotwords: request.hotwords,
        languageHint: spec.languageHint,
      });

      const stamps = {
        providerId: spec.asr.providerId,
        modelId: spec.asr.model,
      };

      // A dictation with an empty transcript has nothing to polish — skip the
      // hop; the orchestrator classifies empty rawText as no_recognition.
      if (rawText.trim().length === 0) {
        return { rawText, finalText: rawText, ...stamps };
      }

      const prompt = buildPolishPrompt(
        request.modePrompt,
        request.hotwords,
        request.axContext,
        rawText,
        request.appProfile === undefined ? {} : { appProfile: request.appProfile },
      );
      const finalText = await llm.complete(prompt.systemPrompt, prompt.userPrompt);
      return {
        rawText,
        finalText,
        ...stamps,
        llmProviderId: spec.llm.providerId,
        llmModelId: spec.llm.model,
      };
    },
  };
}

export function createEngineModelRuntime(
  spec: EngineSpec,
  deps: EngineDeps,
): ModelRuntime {
  const transcription = createEngineTranscription(spec, deps);

  return {
    async respond(input: ModelInput): Promise<ModelOutput> {
      switch (resolveCapability(input.intent, spec)) {
        case "omni":
        case "asr_llm":
          return outputFromTranscription(
            await transcription.respond(transcriptionRequestFromModelInput(input)),
          );
      }
    },
  };
}
