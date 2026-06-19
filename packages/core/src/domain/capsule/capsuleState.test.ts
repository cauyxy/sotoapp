import { describe, expect, it } from "vitest";
import {
  capsuleReducer,
  initialCapsuleState,
  normalizeLevel,
  type CapsuleState,
  type CompleteResult,
} from "./capsuleState.js";
import type { VoiceRuntimeEvent } from "../../contract/events.js";

const startedEvent: VoiceRuntimeEvent = {
  kind: "started",
  handle_id: "h1",
  mode_id: "polish",
  status: "listening",
  mode_name: null,
};

const thinkingEvent: VoiceRuntimeEvent = {
  kind: "thinking",
  handle_id: "h1",
  mode_id: "polish",
  status: "thinking",
  mode_name: null,
};

const insertingEvent: VoiceRuntimeEvent = {
  kind: "inserting",
  handle_id: "h1",
  mode_id: "polish",
  status: "inserting",
  mode_name: null,
};

const completedResult: CompleteResult = {
  history_id: "hist-1",
  raw_text: "hello world",
  final_text: "Hello, world.",
  status: "completed",
  injection_outcome: { kind: "paste_sent" },
};

const completedEvent: VoiceRuntimeEvent = {
  kind: "completed",
  history_id: "hist-1",
  raw_text: "hello world",
  processed_text: "Hello, world.",
  final_text: "Hello, world.",
  status: "completed",
  injection_outcome: { kind: "paste_sent" },
};

describe("initialCapsuleState", () => {
  it("starts idle with zeroed level and null fields", () => {
    expect(initialCapsuleState).toEqual({
      phase: "idle",
      modeId: null,
      modeName: null,
      level: { rms: 0, peak: 0 },
      result: null,
      errorMessage: null,
    });
  });
});

describe("capsuleReducer", () => {
  it("idle -> started moves to listening and records the mode", () => {
    const next = capsuleReducer(initialCapsuleState, startedEvent);
    expect(next.phase).toBe("listening");
    expect(next.modeId).toBe("polish");
  });

  it("level events update level without changing phase", () => {
    const listening = capsuleReducer(initialCapsuleState, startedEvent);
    const next = capsuleReducer(listening, {
      kind: "level",
      rms: 100,
      peak: 200,
    });
    expect(next.phase).toBe("listening");
    expect(next.modeId).toBe("polish");
    expect(next.level).toEqual({ rms: 100, peak: 200 });
  });

  it("thinking moves to thinking and keeps the mode", () => {
    const listening = capsuleReducer(initialCapsuleState, startedEvent);
    const next = capsuleReducer(listening, thinkingEvent);
    expect(next.phase).toBe("thinking");
    expect(next.modeId).toBe("polish");
  });

  it("inserting moves to inserting and keeps the mode", () => {
    const thinking = capsuleReducer(
      capsuleReducer(initialCapsuleState, startedEvent),
      thinkingEvent,
    );
    const next = capsuleReducer(thinking, insertingEvent);
    expect(next.phase).toBe("inserting");
    expect(next.modeId).toBe("polish");
  });

  it("completed sets the result and the completed phase", () => {
    const thinking = capsuleReducer(
      capsuleReducer(initialCapsuleState, startedEvent),
      thinkingEvent,
    );
    const next = capsuleReducer(thinking, completedEvent);
    expect(next.phase).toBe("completed");
    expect(next.result).toEqual(completedResult);
  });

  it("cancelled sets the result and the cancelled phase", () => {
    const next = capsuleReducer(initialCapsuleState, {
      kind: "cancelled",
      history_id: "hist-2",
      raw_text: "",
      processed_text: null,
      final_text: "",
      status: "cancelled",
      injection_outcome: { kind: "no_op" },
      empty_reason: "silent",
    });
    expect(next.phase).toBe("cancelled");
    expect(next.result).toEqual({
      history_id: "hist-2",
      raw_text: "",
      final_text: "",
      status: "cancelled",
      injection_outcome: { kind: "no_op" },
      empty_reason: "silent",
    });
  });

  it("failed sets the result and the failed phase", () => {
    const next = capsuleReducer(initialCapsuleState, {
      kind: "failed",
      history_id: "hist-3",
      raw_text: "x",
      processed_text: null,
      final_text: "x",
      status: "failed",
      injection_outcome: { kind: "failed", detail: "boom" },
    });
    expect(next.phase).toBe("failed");
    expect(next.result?.status).toBe("failed");
  });

  it("error moves to failed and records the message", () => {
    const next = capsuleReducer(initialCapsuleState, {
      kind: "error",
      code: "missing_provider",
      message: "no provider configured",
    });
    expect(next.phase).toBe("failed");
    expect(next.errorMessage).toBe("no provider configured");
  });

  it("tolerates unknown ordering: level before started keeps idle phase", () => {
    const next = capsuleReducer(initialCapsuleState, {
      kind: "level",
      rms: 50,
      peak: 60,
    });
    expect(next.phase).toBe("idle");
    expect(next.modeId).toBeNull();
    expect(next.level).toEqual({ rms: 50, peak: 60 });
  });

  it("is pure: does not mutate the input state", () => {
    const frozen: CapsuleState = Object.freeze({
      ...initialCapsuleState,
      level: Object.freeze({ rms: 0, peak: 0 }),
    });
    expect(() => capsuleReducer(frozen, startedEvent)).not.toThrow();
    expect(frozen.phase).toBe("idle");
    const after = capsuleReducer(frozen, startedEvent);
    expect(after).not.toBe(frozen);
  });

  it("clears stale result/error when a new session starts", () => {
    const completed = capsuleReducer(initialCapsuleState, completedEvent);
    expect(completed.result).not.toBeNull();
    const restarted = capsuleReducer(completed, startedEvent);
    expect(restarted.phase).toBe("listening");
    expect(restarted.result).toBeNull();
    expect(restarted.errorMessage).toBeNull();
  });

  it("clears stale level when a new session starts", () => {
    const previousListening = capsuleReducer(initialCapsuleState, startedEvent);
    const loudPreviousSession = capsuleReducer(previousListening, {
      kind: "level",
      rms: 65535,
      peak: 65535,
    });
    const restarted = capsuleReducer(loudPreviousSession, {
      ...startedEvent,
      handle_id: "h2",
    });
    expect(restarted.phase).toBe("listening");
    expect(restarted.level).toEqual({ rms: 0, peak: 0 });
  });
});

describe("mode identity fields", () => {
  it("started stores mode_name", () => {
    const s = capsuleReducer(initialCapsuleState, {
      kind: "started",
      handle_id: "h1",
      mode_id: "translate",
      status: "listening",
      mode_name: "Translate",
    });
    expect(s.modeName).toBe("Translate");
  });

  it("thinking carries mode_name too", () => {
    const s = capsuleReducer(initialCapsuleState, {
      kind: "thinking",
      handle_id: "h1",
      mode_id: "rewrite",
      status: "thinking",
      mode_name: "Rewrite",
    });
    expect(s.modeName).toBe("Rewrite");
  });

  it("slow events do not change capsule state", () => {
    const s = capsuleReducer(initialCapsuleState, {
      kind: "slow",
      mode_id: "default",
      elapsed_ms: 8000,
    });
    expect(s).toBe(initialCapsuleState);
  });
});

describe("normalizeLevel", () => {
  it("maps 0..65535 onto 0..1", () => {
    expect(normalizeLevel(0)).toBe(0);
    expect(normalizeLevel(65535)).toBe(1);
    expect(normalizeLevel(32767.5)).toBeCloseTo(0.5);
  });

  it("clamps out-of-range input", () => {
    expect(normalizeLevel(-100)).toBe(0);
    expect(normalizeLevel(100000)).toBe(1);
  });
});
