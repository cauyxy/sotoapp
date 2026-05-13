import { describe, expect, it } from "vitest";

import {
  SESSION_COMMANDS,
  buildCancelVoiceSessionRequest,
  buildCompleteFinalTranscriptRequest,
  buildCompleteVoiceSessionRequest,
  buildStartVoiceSessionRequest,
  type CancelVoiceSessionRequest,
  type CompleteFinalTranscriptRequest,
  type CompleteVoiceSessionRequest,
  type StartVoiceSessionRequest
} from "./sessions.ipc";

describe("session IPC model", () => {
  it("matches backend final transcript command name", () => {
    expect(SESSION_COMMANDS).toEqual({
      startVoiceSession: "start_voice_session",
      completeFinalTranscriptSession: "complete_final_transcript_session",
      completeVoiceSession: "complete_voice_session",
      cancelVoiceSession: "cancel_voice_session",
      cancelActiveVoiceRuntime: "cancel_active_voice_runtime",
      finishActiveVoiceRuntime: "finish_active_voice_runtime"
    });
  });

  it("builds trimmed final transcript completion requests", () => {
    const request: CompleteFinalTranscriptRequest = buildCompleteFinalTranscriptRequest({
      modeId: " default ",
      rawText: " rough text ",
      speakingDurationMs: 420,
      targetApp: " Notes ",
      targetWindowTitle: " Draft ",
      targetControlType: " text_area "
    });

    expect(request).toEqual({
      mode_id: "default",
      raw_text: "rough text",
      speaking_duration_ms: 420,
      target_app: "Notes",
      target_window_title: "Draft",
      target_control_type: "text_area"
    });
  });

  it("builds trimmed cancel voice session requests", () => {
    const request: CancelVoiceSessionRequest = buildCancelVoiceSessionRequest({
      modeId: " default ",
      speakingDurationMs: 240.4,
      targetApp: " Notes ",
      targetWindowTitle: " Draft ",
      targetControlType: " text_area "
    });

    expect(request).toEqual({
      mode_id: "default",
      speaking_duration_ms: 240,
      target_app: "Notes",
      target_window_title: "Draft",
      target_control_type: "text_area"
    });
  });

  it("builds start and complete voice session handle requests", () => {
    const start: StartVoiceSessionRequest = buildStartVoiceSessionRequest({
      modeId: " default ",
      targetApp: " Notes ",
      targetWindowTitle: " Draft ",
      targetControlType: " text_area "
    });
    const complete: CompleteVoiceSessionRequest = buildCompleteVoiceSessionRequest(
      " session.1 ",
      " final text "
    );

    expect(start).toEqual({
      mode_id: "default",
      target_app: "Notes",
      target_window_title: "Draft",
      target_control_type: "text_area"
    });
    expect(complete).toEqual({
      handle_id: "session.1",
      raw_text: "final text"
    });
  });
});
