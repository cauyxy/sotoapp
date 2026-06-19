import { describe, expect, it } from "vitest";
import { HotkeyRuntime, hotkeyRuntimeActionFor } from "./runtime.js";
import { HotkeyRuntimeActionSchema } from "../../contract/events.js";

// Mac keycodes used in tests.
const MAC_RIGHT_META = 0x36;
const MAC_LEFT_CTRL = 0x3b;
const MAC_LEFT_SHIFT = 0x38;
const MAC_A = 0x00;

describe("HotkeyRuntime (mac mapper)", () => {
  it("toggles a RightMeta binding: down -> start, down -> complete", () => {
    const rt = new HotkeyRuntime("mac");
    rt.setBindings([{ chord: "RightMeta", modeId: "dictate" }]);

    expect(rt.feed({ key: MAC_RIGHT_META, down: true, repeat: false })).toEqual([
      { type: "start", modeId: "dictate" },
    ]);
    // Release is ignored by the coordinator.
    expect(
      rt.feed({ key: MAC_RIGHT_META, down: false, repeat: false }),
    ).toEqual([]);
    // Second press completes.
    expect(rt.feed({ key: MAC_RIGHT_META, down: true, repeat: false })).toEqual([
      { type: "complete", modeId: "dictate" },
    ]);
  });

  it("ignores non-modifier keys", () => {
    const rt = new HotkeyRuntime("mac");
    rt.setBindings([{ chord: "RightMeta", modeId: "dictate" }]);
    expect(rt.feed({ key: MAC_A, down: true, repeat: false })).toEqual([]);
  });

  it("ignores autorepeat events", () => {
    const rt = new HotkeyRuntime("mac");
    rt.setBindings([{ chord: "RightMeta", modeId: "dictate" }]);
    expect(rt.feed({ key: MAC_RIGHT_META, down: true, repeat: true })).toEqual(
      [],
    );
  });

  it("resolves a multi-modifier chord and maps chordIndex -> modeId", () => {
    const rt = new HotkeyRuntime("mac");
    rt.setBindings([
      { chord: "RightMeta", modeId: "dictate" },
      { chord: "LeftCtrl+LeftShift", modeId: "command" },
    ]);

    expect(rt.feed({ key: MAC_LEFT_CTRL, down: true, repeat: false })).toEqual(
      [],
    );
    expect(rt.feed({ key: MAC_LEFT_SHIFT, down: true, repeat: false })).toEqual([
      { type: "start", modeId: "command" },
    ]);
  });

  it("throws when bindings are not disjoint", () => {
    const rt = new HotkeyRuntime("mac");
    expect(() =>
      rt.setBindings([
        { chord: "LeftCtrl+LeftShift", modeId: "a" },
        { chord: "LeftShift", modeId: "b" },
      ]),
    ).toThrow();
  });

  it("cancelActive cancels the running session", () => {
    const rt = new HotkeyRuntime("mac");
    rt.setBindings([{ chord: "RightMeta", modeId: "dictate" }]);
    rt.feed({ key: MAC_RIGHT_META, down: true, repeat: false });

    expect(rt.cancelActive()).toEqual({ type: "cancel", modeId: "dictate" });
    expect(rt.cancelActive()).toBeNull();
  });

  it("clearHeld releases held modifiers (no action, releases ignored)", () => {
    const rt = new HotkeyRuntime("mac");
    rt.setBindings([{ chord: "RightMeta", modeId: "dictate" }]);
    rt.feed({ key: MAC_RIGHT_META, down: true, repeat: false }); // start

    // clearHeld releases the chord; coordinator ignores releases -> no actions.
    expect(rt.clearHeld()).toEqual([]);

    // After clearing held state, re-pressing must start fresh, not complete.
    expect(rt.feed({ key: MAC_RIGHT_META, down: true, repeat: false })).toEqual(
      [{ type: "complete", modeId: "dictate" }],
    );
  });
});

describe("HotkeyRuntime (windows mapper + injected mapper)", () => {
  it("uses the windows mapper with flags for generic VKs", () => {
    const rt = new HotkeyRuntime("windows");
    rt.setBindings([{ chord: "RightCtrl", modeId: "dictate" }]);
    // Generic VK_CONTROL with extended flag => RightCtrl.
    expect(
      rt.feed({ key: 0x11, down: true, repeat: false, flags: 0x01 }),
    ).toEqual([{ type: "start", modeId: "dictate" }]);
  });

  it("accepts an injected key->Modifier mapper", () => {
    const rt = new HotkeyRuntime((key) => (key === 99 ? "RightAlt" : null));
    rt.setBindings([{ chord: "RightAlt", modeId: "x" }]);
    expect(rt.feed({ key: 99, down: true, repeat: false })).toEqual([
      { type: "start", modeId: "x" },
    ]);
    expect(rt.feed({ key: 1, down: true, repeat: false })).toEqual([]);
  });
});

describe("hotkeyRuntimeActionFor", () => {
  it("maps coordinator actions to validated wire payloads (ignore -> null)", () => {
    expect(hotkeyRuntimeActionFor({ type: "start", modeId: "m" })).toEqual({
      kind: "start_recording",
      mode_id: "m",
    });
    expect(hotkeyRuntimeActionFor({ type: "complete", modeId: "m" })).toEqual({
      kind: "finish_recording",
      mode_id: "m",
    });
    expect(hotkeyRuntimeActionFor({ type: "cancel", modeId: "m" })).toEqual({
      kind: "cancel_recording",
      mode_id: "m",
    });
    expect(hotkeyRuntimeActionFor({ type: "ignore" })).toBeNull();
    // output is valid against the wire schema
    const wire = hotkeyRuntimeActionFor({ type: "start", modeId: "m" });
    expect(HotkeyRuntimeActionSchema.parse(wire)).toEqual(wire);
  });
});
