export const VOICE_BAR_STATES = ["idle", "listening", "thinking", "error"] as const;
export type VoiceBarState = (typeof VOICE_BAR_STATES)[number];

export const VOICE_RUNTIME_EVENT = "soto://voice-runtime" as const;
export const VOICE_BAR_TERMINAL_ERROR_RESET_MS = 3000;

export const VOICE_RUNTIME_ERROR_CODES = ["missing_provider", "generic"] as const;
export type VoiceRuntimeErrorCode = (typeof VOICE_RUNTIME_ERROR_CODES)[number];
export type EmptyReason = "too_short" | "silent" | "no_recognition";

export type VoiceRuntimeEvent = {
  kind: "started" | "thinking" | "completed" | "cancelled" | "failed" | "error" | "level";
  rms?: number;
  peak?: number;
  code?: VoiceRuntimeErrorCode;
  message?: string;
  empty_reason?: EmptyReason;
};

export function voiceBarStateForRuntimeEvent(event: VoiceRuntimeEvent): VoiceBarState {
  if (event.kind === "started") return "listening";
  if (event.kind === "thinking") return "thinking";
  if (event.kind === "level") return "listening";
  if (event.kind === "completed" || event.kind === "cancelled") return "idle";
  return "error";
}

export function voiceBarStateAfterTerminalPresentation(state: VoiceBarState): VoiceBarState {
  if (state === "error") return "idle";
  return state;
}
