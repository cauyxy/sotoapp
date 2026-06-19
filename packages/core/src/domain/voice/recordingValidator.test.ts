import { describe, expect, it } from "vitest";
import { validateRecording } from "./recordingValidator.js";

function recording(overrides: Partial<Parameters<typeof validateRecording>[0]> = {}) {
  return {
    durationMs: 1000,
    peak: 0.5,
    voicedMs: 1000,
    ...overrides,
  };
}

describe("validateRecording allowSilent", () => {
  it("accepts a silent-but-long recording when allowSilent is set", () => {
    const r = validateRecording(recording({ peak: 0, voicedMs: 0 }), { allowSilent: true });
    expect(r.accepted).toBe(true);
  });

  it("still rejects a too-short recording even with allowSilent", () => {
    const r = validateRecording(recording({ durationMs: 100 }), { allowSilent: true });
    expect(r).toEqual({ accepted: false, reason: "too_short" });
  });

  it("rejects silent recordings by default (allowSilent off)", () => {
    const r = validateRecording(recording({ peak: 0 }));
    expect(r).toEqual({ accepted: false, reason: "silent" });
  });
});

describe("validateRecording", () => {
  it("rejects a recording shorter than 300ms as too_short", () => {
    expect(validateRecording(recording({ durationMs: 299 }))).toEqual({
      accepted: false,
      reason: "too_short",
    });
  });

  it("rejects a long-enough but quiet recording as silent", () => {
    expect(validateRecording(recording({ peak: 0.002 }))).toEqual({
      accepted: false,
      reason: "silent",
    });
  });

  it("rejects a long-enough recording with no voiced frames as silent", () => {
    expect(validateRecording(recording({ voicedMs: 0 }))).toEqual({
      accepted: false,
      reason: "silent",
    });
  });

  it("rejects a long-enough recording with too little voiced duration as too_short", () => {
    expect(validateRecording(recording({ voicedMs: 200 }))).toEqual({
      accepted: false,
      reason: "too_short",
    });
  });

  it("accepts a recording that clears both gates", () => {
    expect(validateRecording(recording())).toEqual({
      accepted: true,
    });
  });

  it("uses strict <: exactly 300ms passes the duration gate", () => {
    expect(validateRecording(recording({ durationMs: 300 }))).toEqual({
      accepted: true,
    });
  });

  it("uses strict <: a peak of exactly 0.003 passes the silence gate", () => {
    expect(validateRecording(recording({ peak: 0.003 }))).toEqual({
      accepted: true,
    });
  });

  it("uses strict <: exactly 250 voiced ms passes the voiced-duration gate", () => {
    expect(validateRecording(recording({ voicedMs: 250 }))).toEqual({
      accepted: true,
    });
  });

  it("checks duration before peak: too_short wins when both fail", () => {
    expect(validateRecording(recording({ durationMs: 100, peak: 0, voicedMs: 0 }))).toEqual({
      accepted: false,
      reason: "too_short",
    });
  });

  it("checks silent voiced duration before voiced too_short", () => {
    expect(validateRecording(recording({ voicedMs: 0 }))).toEqual({
      accepted: false,
      reason: "silent",
    });
  });
});
