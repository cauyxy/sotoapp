import { describe, expect, it } from "vitest";
import {
  HotkeyRuntimeActionSchema,
  VoiceRuntimeEventSchema,
} from "./events.js";

describe("HotkeyRuntimeActionSchema", () => {
  it("parses each variant (snake_case kind + mode_id)", () => {
    for (const kind of [
      "start_recording",
      "finish_recording",
      "cancel_recording",
    ] as const) {
      expect(
        HotkeyRuntimeActionSchema.parse({ kind, mode_id: "dictate" }),
      ).toEqual({ kind, mode_id: "dictate" });
    }
  });

  it("rejects an unknown kind", () => {
    expect(() =>
      HotkeyRuntimeActionSchema.parse({ kind: "start", mode_id: "x" }),
    ).toThrow();
  });
});

describe("VoiceRuntimeEventSchema", () => {
  it("parses started/thinking with flattened handle fields", () => {
    expect(
      VoiceRuntimeEventSchema.parse({
        kind: "started",
        handle_id: "h1",
        mode_id: "dictate",
        status: "listening",
        mode_name: null,
      }),
    ).toMatchObject({ kind: "started", status: "listening" });

    expect(
      VoiceRuntimeEventSchema.parse({
        kind: "thinking",
        handle_id: "h1",
        mode_id: "dictate",
        status: "thinking",
        mode_name: null,
      }),
    ).toMatchObject({ kind: "thinking", status: "thinking" });

    expect(
      VoiceRuntimeEventSchema.parse({
        kind: "inserting",
        handle_id: "h1",
        mode_id: "dictate",
        status: "inserting",
        mode_name: null,
      }),
    ).toMatchObject({ kind: "inserting", status: "inserting" });
  });

  it("parses completed with flattened result + paste_sent injection outcome", () => {
    const parsed = VoiceRuntimeEventSchema.parse({
      kind: "completed",
      history_id: "hist1",
      raw_text: "hello",
      processed_text: null,
      final_text: "hello",
      status: "completed",
      injection_outcome: { kind: "paste_sent" },
    });
    expect(parsed).toMatchObject({
      kind: "completed",
      processed_text: null,
      injection_outcome: { kind: "paste_sent" },
    });
  });

  it("parses cancelled with a no_op outcome", () => {
    expect(
      VoiceRuntimeEventSchema.parse({
        kind: "cancelled",
        history_id: "h",
        raw_text: "",
        processed_text: null,
        final_text: "",
        status: "cancelled",
        injection_outcome: { kind: "no_op" },
      }).kind,
    ).toBe("cancelled");
  });

  it("parses failed with a failed injection outcome carrying a detail string", () => {
    const parsed = VoiceRuntimeEventSchema.parse({
      kind: "failed",
      history_id: "h",
      raw_text: "x",
      processed_text: "x",
      final_text: "x",
      status: "failed",
      injection_outcome: { kind: "failed", detail: "boom" },
    });
    expect(parsed.kind).toBe("failed");
  });

  it("parses focus_lost injection outcome with an object detail", () => {
    const parsed = VoiceRuntimeEventSchema.parse({
      kind: "completed",
      history_id: "h",
      raw_text: "x",
      processed_text: null,
      final_text: "x",
      status: "completed",
      injection_outcome: {
        kind: "focus_lost",
        detail: { saved_app_name: "A", actual_app_name: "B" },
      },
    });
    expect(parsed).toMatchObject({
      injection_outcome: {
        kind: "focus_lost",
        detail: { saved_app_name: "A", actual_app_name: "B" },
      },
    });
  });

  it("accepts an optional empty_reason and rejects an unknown one", () => {
    const parsed = VoiceRuntimeEventSchema.parse({
      kind: "completed",
      history_id: "h",
      raw_text: "",
      processed_text: null,
      final_text: "",
      status: "empty",
      injection_outcome: { kind: "no_op" },
      empty_reason: "silent",
    });
    expect(parsed).toMatchObject({ empty_reason: "silent" });

    expect(() =>
      VoiceRuntimeEventSchema.parse({
        kind: "completed",
        history_id: "h",
        raw_text: "",
        processed_text: null,
        final_text: "",
        status: "empty",
        injection_outcome: { kind: "no_op" },
        empty_reason: "bogus",
      }),
    ).toThrow();
  });

  it("parses error with code + message", () => {
    expect(
      VoiceRuntimeEventSchema.parse({
        kind: "error",
        code: "missing_provider",
        message: "no provider",
      }),
    ).toEqual({
      kind: "error",
      code: "missing_provider",
      message: "no provider",
    });
  });

  it("parses the missing_mode + runtime_unavailable error codes", () => {
    for (const code of ["missing_mode", "runtime_unavailable"] as const) {
      expect(
        VoiceRuntimeEventSchema.safeParse({ kind: "error", code, message: "x" }).success,
      ).toBe(true);
    }
  });

  it("parses level with integer rms/peak in 0..=65535", () => {
    expect(
      VoiceRuntimeEventSchema.parse({ kind: "level", rms: 0, peak: 65535 }),
    ).toEqual({ kind: "level", rms: 0, peak: 65535 });

    expect(() =>
      VoiceRuntimeEventSchema.parse({ kind: "level", rms: -1, peak: 0 }),
    ).toThrow();
    expect(() =>
      VoiceRuntimeEventSchema.parse({ kind: "level", rms: 1.5, peak: 0 }),
    ).toThrow();
    expect(() =>
      VoiceRuntimeEventSchema.parse({ kind: "level", rms: 0, peak: 70000 }),
    ).toThrow();
  });
});
