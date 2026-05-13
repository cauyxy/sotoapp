import { invoke } from "@tauri-apps/api/core";
import type { EmptyReason } from "../shared/voice";

export const SESSION_COMMANDS = {
  startVoiceSession: "start_voice_session",
  completeFinalTranscriptSession: "complete_final_transcript_session",
  completeVoiceSession: "complete_voice_session",
  cancelVoiceSession: "cancel_voice_session",
  cancelActiveVoiceRuntime: "cancel_active_voice_runtime",
  finishActiveVoiceRuntime: "finish_active_voice_runtime"
} as const;

export type SessionStatus = "completed" | "empty" | "failed" | "cancelled";

export type InjectionOutcome =
  | {
      kind: "inserted";
    }
  | {
      kind: "paste_sent";
    }
  | {
      kind: "copied_fallback";
    }
  | {
      kind: "no_op";
    }
  | {
      kind: "failed";
      detail: string;
    };

export type VoiceSessionStatus = "listening" | "thinking" | "error";

export interface VoiceSessionHandle {
  handle_id: string;
  mode_id: string;
  status: VoiceSessionStatus;
}

export interface StartVoiceSessionRequest {
  mode_id: string;
  target_app: string;
  target_window_title: string;
  target_control_type: string;
}

export interface CompleteVoiceSessionRequest {
  handle_id: string;
  raw_text: string;
}

export interface CompleteFinalTranscriptRequest {
  mode_id: string;
  raw_text: string;
  speaking_duration_ms: number;
  target_app: string;
  target_window_title: string;
  target_control_type: string;
}

export type CancelVoiceSessionRequest = Omit<CompleteFinalTranscriptRequest, "raw_text">;

export interface CompleteFinalTranscriptResult {
  history_id: string;
  raw_text: string;
  processed_text: string | null;
  final_text: string;
  status: SessionStatus;
  injection_outcome: InjectionOutcome;
  empty_reason?: EmptyReason;
}

export interface CompleteFinalTranscriptDraft {
  modeId: string;
  rawText: string;
  speakingDurationMs: number;
  targetApp: string;
  targetWindowTitle: string;
  targetControlType: string;
}

export interface StartVoiceSessionDraft {
  modeId: string;
  targetApp: string;
  targetWindowTitle: string;
  targetControlType: string;
}

export type CancelVoiceSessionDraft = Omit<CompleteFinalTranscriptDraft, "rawText">;

export function buildStartVoiceSessionRequest(
  draft: StartVoiceSessionDraft
): StartVoiceSessionRequest {
  return {
    mode_id: draft.modeId.trim(),
    target_app: draft.targetApp.trim(),
    target_window_title: draft.targetWindowTitle.trim(),
    target_control_type: draft.targetControlType.trim()
  };
}

export function buildCompleteFinalTranscriptRequest(
  draft: CompleteFinalTranscriptDraft
): CompleteFinalTranscriptRequest {
  return {
    mode_id: draft.modeId.trim(),
    raw_text: draft.rawText.trim(),
    speaking_duration_ms: Math.max(0, Math.round(draft.speakingDurationMs)),
    target_app: draft.targetApp.trim(),
    target_window_title: draft.targetWindowTitle.trim(),
    target_control_type: draft.targetControlType.trim()
  };
}

export function buildCompleteVoiceSessionRequest(
  handleId: string,
  rawText: string
): CompleteVoiceSessionRequest {
  return {
    handle_id: handleId.trim(),
    raw_text: rawText.trim()
  };
}

export function buildCancelVoiceSessionRequest(
  draft: CancelVoiceSessionDraft
): CancelVoiceSessionRequest {
  return {
    mode_id: draft.modeId.trim(),
    speaking_duration_ms: Math.max(0, Math.round(draft.speakingDurationMs)),
    target_app: draft.targetApp.trim(),
    target_window_title: draft.targetWindowTitle.trim(),
    target_control_type: draft.targetControlType.trim()
  };
}

export async function startVoiceSession(
  request: StartVoiceSessionRequest
): Promise<VoiceSessionHandle> {
  return invoke(SESSION_COMMANDS.startVoiceSession, { request });
}

export async function completeFinalTranscriptSession(
  request: CompleteFinalTranscriptRequest
): Promise<CompleteFinalTranscriptResult> {
  return invoke(SESSION_COMMANDS.completeFinalTranscriptSession, { request });
}

export async function completeVoiceSession(
  request: CompleteVoiceSessionRequest
): Promise<CompleteFinalTranscriptResult> {
  return invoke(SESSION_COMMANDS.completeVoiceSession, { request });
}

export async function cancelVoiceSession(
  request: CancelVoiceSessionRequest
): Promise<CompleteFinalTranscriptResult> {
  return invoke(SESSION_COMMANDS.cancelVoiceSession, { request });
}

export async function cancelActiveVoiceRuntime(): Promise<void> {
  await invoke(SESSION_COMMANDS.cancelActiveVoiceRuntime);
}

export async function finishActiveVoiceRuntime(): Promise<void> {
  await invoke(SESSION_COMMANDS.finishActiveVoiceRuntime);
}

export type { EmptyReason } from "../shared/voice";
