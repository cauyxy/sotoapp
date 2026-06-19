import type {
  AppInfo,
  HistoryRecord,
  InjectionOutcome,
  SessionStatus,
} from "../../contract/schema.js";
import {
  historyTargetContextOf,
  type AppContext,
} from "../../capabilities/context/context.js";
import type { ModelOutput } from "../../capabilities/model-input/modelInput.js";

interface VoiceHistoryTarget {
  app: string | null;
  windowTitle: string | null;
  controlType: string | null;
}

export interface VoiceHistoryRecordInput {
  id: string;
  createdAt: number;
  modeId: string;
  recordingDurationMs: number;
  rawText: string;
  processedText: string | null;
  finalText: string;
  status: SessionStatus;
  injectionOutcome: InjectionOutcome;
  savedApp: AppInfo | null;
  target: VoiceHistoryTarget;
  appContext: AppContext;
  providerTrace: ModelOutput["providerTrace"];
}

export function historyRecordForVoiceSession(
  input: VoiceHistoryRecordInput,
): HistoryRecord {
  const historyAxContext = historyTargetContextOf(input.appContext);
  return {
    id: input.id,
    created_at: BigInt(input.createdAt),
    raw_text: input.rawText,
    processed_text: input.processedText,
    injected_text: input.finalText,
    edited_text: null,
    edited_text_status: "pending",
    edited_text_status_reason: null,
    mode_id: input.modeId,
    status: input.status,
    injection_outcome: input.injectionOutcome,
    speaking_duration_ms: BigInt(input.recordingDurationMs),
    char_count: [...input.finalText].length,
    target_app: input.target.app,
    target_app_name: input.savedApp?.localizedName ?? null,
    target_window_title: input.target.windowTitle,
    target_control_type: input.target.controlType,
    ax_context_at_start: historyAxContext,
    ax_context_at_end: null,
    audio_path: null,
    provider_id: input.providerTrace.recognitionProviderId,
    model_id: input.providerTrace.recognitionModelId,
    // LLM-hop provenance - non-null only when the ASR + LLM engine actually
    // ran the text post-process (engine spec section 3.6).
    llm_provider_id: input.providerTrace.llmProviderId,
    llm_model_id: input.providerTrace.llmModelId,
    detected_language: null,
    mic_device_id: null,
  };
}
