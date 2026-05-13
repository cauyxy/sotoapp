import { describe, expect, it } from "vitest";

import {
  VOICE_BAR_STATES,
  VOICE_RUNTIME_EVENT,
  voiceBarStateAfterTerminalPresentation,
  voiceBarStateForRuntimeEvent
} from "./voice";

describe("voice IPC helpers", () => {
  it("maps backend runtime events onto the final-only Voice Bar states", () => {
    expect(VOICE_RUNTIME_EVENT).toBe("soto://voice-runtime");
    expect(voiceBarStateForRuntimeEvent({ kind: "started" })).toBe("listening");
    expect(voiceBarStateForRuntimeEvent({ kind: "thinking" })).toBe("thinking");
    expect(voiceBarStateForRuntimeEvent({ kind: "level", rms: 120, peak: 250 })).toBe("listening");
    expect(voiceBarStateForRuntimeEvent({ kind: "completed" })).toBe("idle");
    expect(voiceBarStateForRuntimeEvent({ kind: "cancelled" })).toBe("idle");
    expect(voiceBarStateForRuntimeEvent({ kind: "failed" })).toBe("error");
    expect(voiceBarStateForRuntimeEvent({ kind: "error", message: "microphone unavailable" })).toBe(
      "error"
    );
  });

  it("keeps Voice Bar states final-only and clears terminal presentation state", () => {
    expect(VOICE_BAR_STATES).toEqual(["idle", "listening", "thinking", "error"]);
    expect(VOICE_BAR_STATES).not.toContain("partial");
    expect(VOICE_BAR_STATES).not.toContain("transcribing");

    expect(voiceBarStateAfterTerminalPresentation("error")).toBe("idle");
    expect(voiceBarStateAfterTerminalPresentation("listening")).toBe("listening");
    expect(voiceBarStateAfterTerminalPresentation("thinking")).toBe("thinking");
    expect(voiceBarStateAfterTerminalPresentation("idle")).toBe("idle");
  });
});
