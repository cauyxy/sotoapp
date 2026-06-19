// HotkeyService unit tests with a fake native hook + fake mode list: install
// builds bindings from the saved modes, rebind() picks up later mode edits
// (the save_mode → onModesChanged path), and rejected bindings keep the
// previous registry. Uses mac CGEvent keycodes with an injected "mac" platform
// so the fixtures behave the same on every host (the default mapper follows
// process.platform).

import { afterEach, describe, expect, it, vi } from "vitest";
import type { HotkeyRuntimeAction, Mode } from "@soto/core";
import {
  HOTKEY_CAPTURE_TIMEOUT_MS,
  HotkeyService,
  bindingsFromModes,
  classifyCaptureEdge,
} from "./hotkeyService.js";

const MAC_RIGHT_CTRL = 0x3e;
const MAC_RIGHT_ALT = 0x3d;
const MAC_FN = 0x3f;
const MAC_ESCAPE = 0x35;
const MAC_RETURN = 0x24;
const MAC_A = 0x00;
const WIN_RIGHT_CTRL = 0xa3;
const WIN_ESCAPE = 0x1b;
const WIN_RETURN = 0x0d;

type HookCallback = (ev: {
  key: number;
  down: boolean;
  repeat: boolean;
  flags: number;
}) => boolean;

function makeMode(id: string, chord: string | null): Mode {
  return {
    id,
    name: id,
    prompt_body: "",
    hotkey: chord === null ? null : { chord },
    display_order: 0,
    built_in: false,
    created_at: 0n,
    updated_at: 0n,
  };
}

function makeService(
  initialModes: Mode[],
  installResult = true,
  supportsSuppression = true,
) {
  const state = {
    modes: initialModes,
    callback: null as HookCallback | null,
    installCalls: 0,
    actions: [] as HotkeyRuntimeAction[],
    now: 1_000,
  };
  const service = new HotkeyService({
    listModes: () => state.modes,
    hotkey: {
      supportsSuppression,
      install: (onEvent: HookCallback) => {
        state.installCalls += 1;
        if (installResult) state.callback = onEvent;
        return installResult;
      },
      shutdown: () => {},
    },
    dispatch: (action) => state.actions.push(action),
    // Pin the mac keycode mapper: the fixtures are CGEvent keycodes, and the
    // host-platform default would pick the windows mapper on a Windows host.
    platform: "mac",
  });
  return { service, state };
}

/** One press+release of a key (the coordinator toggles on presses only). */
function tap(state: { callback: HookCallback | null }, key: number): void {
  state.callback?.({ key, down: true, repeat: false, flags: 0 });
  state.callback?.({ key, down: false, repeat: false, flags: 0 });
}

describe("bindingsFromModes", () => {
  it("keeps hotkeyed modes and drops invalid chords + modes without a hotkey", () => {
    const bindings = bindingsFromModes([
      makeMode("a", "RightCtrl"),
      makeMode("b", null),
      makeMode("c", "NotAModifier"),
    ]);
    expect(bindings).toEqual([{ chord: "RightCtrl", modeId: "a" }]);
  });
});

describe("HotkeyService", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("installs the hook and dispatches start/finish for a bound chord", () => {
    const { service, state } = makeService([makeMode("default", "RightCtrl")]);
    expect(service.install()).toBe(true);
    expect(state.installCalls).toBe(1);

    // Toggle semantics (HotkeySessionCoordinator): first press starts, the
    // release is ignored, a second press completes.
    tap(state, MAC_RIGHT_CTRL);
    tap(state, MAC_RIGHT_CTRL);
    expect(state.actions).toEqual([
      { kind: "start_recording", mode_id: "default" },
      { kind: "finish_recording", mode_id: "default" },
    ]);
  });

  it("returns false when the native hook cannot be created", () => {
    const { service } = makeService([makeMode("default", "RightCtrl")], false);
    expect(service.install()).toBe(false);
  });

  it("rebind() applies edited bindings without re-installing the hook", () => {
    const { service, state } = makeService([makeMode("default", "RightCtrl")]);
    expect(service.install()).toBe(true);

    // Mode edited: chord moves RightCtrl -> Fn.
    state.modes = [makeMode("default", "Fn")];
    expect(service.rebind()).toBe(true);
    expect(state.installCalls).toBe(1);

    tap(state, MAC_RIGHT_CTRL);
    expect(state.actions).toEqual([]);

    tap(state, MAC_FN);
    tap(state, MAC_FN);
    expect(state.actions).toEqual([
      { kind: "start_recording", mode_id: "default" },
      { kind: "finish_recording", mode_id: "default" },
    ]);
  });

  it("rebind() keeps the previous bindings when the new set is rejected", () => {
    const { service, state } = makeService([makeMode("default", "RightCtrl")]);
    expect(service.install()).toBe(true);

    // Non-disjoint chords: both share RightCtrl -> setBindings throws.
    state.modes = [makeMode("a", "RightCtrl"), makeMode("b", "RightCtrl+Fn")];
    expect(service.rebind()).toBe(false);

    tap(state, MAC_RIGHT_CTRL);
    tap(state, MAC_RIGHT_CTRL);
    expect(state.actions).toEqual([
      { kind: "start_recording", mode_id: "default" },
      { kind: "finish_recording", mode_id: "default" },
    ]);
  });

  it("rebind() is a no-op before install", () => {
    const { service } = makeService([makeMode("default", "RightCtrl")]);
    expect(service.rebind()).toBe(false);
  });

  it("captures key edges through the native hook, reports suppression, and skips runtime dispatch", () => {
    const { service, state } = makeService([makeMode("default", "RightCtrl")]);
    expect(service.install()).toBe(true);

    const keys: unknown[] = [];
    expect(service.beginCapture((key) => keys.push(key))).toEqual({
      active: true,
      suppressing: true,
      sessionId: 1,
    });

    expect(
      state.callback?.({ key: MAC_RIGHT_CTRL, down: true, repeat: false, flags: 0 }),
    ).toBe(true);
    expect(
      state.callback?.({ key: MAC_RIGHT_CTRL, down: false, repeat: false, flags: 0 }),
    ).toBe(true);
    expect(
      state.callback?.({ key: MAC_RETURN, down: true, repeat: false, flags: 0 }),
    ).toBe(true);
    expect(
      state.callback?.({ key: MAC_A, down: true, repeat: false, flags: 0 }),
    ).toBe(true);
    expect(
      state.callback?.({ key: MAC_A, down: false, repeat: false, flags: 0 }),
    ).toBe(true);
    expect(
      state.callback?.({ key: MAC_RIGHT_CTRL, down: true, repeat: true, flags: 0 }),
    ).toBe(true);

    expect(keys).toEqual([
      { kind: "modifier", modifier: "RightCtrl", down: true },
      { kind: "modifier", modifier: "RightCtrl", down: false },
      { kind: "confirm" },
      { kind: "other" },
    ]);
    expect(state.actions).toEqual([]);
  });

  it("restores pass-through only for the current capture session", () => {
    const { service, state } = makeService([makeMode("default", "RightCtrl")]);
    expect(service.install()).toBe(true);

    const first = service.beginCapture(() => {});
    const second = service.beginCapture(() => {});
    service.endCapture(first.sessionId);

    expect(
      state.callback?.({ key: MAC_RIGHT_CTRL, down: true, repeat: false, flags: 0 }),
    ).toBe(true);
    expect(state.actions).toEqual([]);

    service.endCapture(second.sessionId);
    expect(
      state.callback?.({ key: MAC_RIGHT_CTRL, down: true, repeat: false, flags: 0 }),
    ).toBe(false);
    expect(state.actions).toEqual([
      { kind: "start_recording", mode_id: "default" },
    ]);
  });

  it("forceEndCapture tears down capture unconditionally", () => {
    const { service, state } = makeService([makeMode("default", "RightCtrl")]);
    expect(service.install()).toBe(true);

    service.beginCapture(() => {});
    service.forceEndCapture();

    expect(
      state.callback?.({ key: MAC_RIGHT_CTRL, down: true, repeat: false, flags: 0 }),
    ).toBe(false);
    expect(state.actions).toEqual([
      { kind: "start_recording", mode_id: "default" },
    ]);
  });

  it("watchdog ends the current capture and notifies the sink", async () => {
    vi.useFakeTimers();
    const { service, state } = makeService([makeMode("default", "RightCtrl")]);
    expect(service.install()).toBe(true);
    const keys: unknown[] = [];

    service.beginCapture((key) => keys.push(key));
    await vi.advanceTimersByTimeAsync(HOTKEY_CAPTURE_TIMEOUT_MS + 1);

    expect(keys).toEqual([{ kind: "ended", reason: "timeout" }]);
    expect(
      state.callback?.({ key: MAC_RIGHT_CTRL, down: true, repeat: false, flags: 0 }),
    ).toBe(false);
  });

  it("reports capture as inactive before install and non-suppressing on polling ports", () => {
    const inactive = makeService([makeMode("default", "RightCtrl")]);
    expect(inactive.service.beginCapture(() => {})).toEqual({
      active: false,
      suppressing: false,
      sessionId: 0,
    });

    const polling = makeService([makeMode("default", "RightCtrl")], true, false);
    expect(polling.service.install()).toBe(true);
    expect(polling.service.beginCapture(() => {})).toEqual({
      active: true,
      suppressing: false,
      sessionId: 1,
    });
  });

  it("records capture keys but does not request swallowing on non-suppressing hotkey ports", () => {
    const { service, state } = makeService([makeMode("default", "RightCtrl")], true, false);
    expect(service.install()).toBe(true);

    const keys: unknown[] = [];
    expect(service.beginCapture((key) => keys.push(key))).toEqual({
      active: true,
      suppressing: false,
      sessionId: 1,
    });

    expect(
      state.callback?.({ key: MAC_RIGHT_CTRL, down: true, repeat: false, flags: 0 }),
    ).toBe(false);
    expect(keys).toEqual([{ kind: "modifier", modifier: "RightCtrl", down: true }]);
    expect(state.actions).toEqual([]);
  });

  it("ignores unbound modifier taps", () => {
    const { service, state } = makeService([makeMode("default", "RightCtrl")]);
    expect(service.install()).toBe(true);

    tap(state, MAC_RIGHT_ALT);
    tap(state, MAC_RIGHT_ALT);

    expect(state.actions).toEqual([]);
  });
});

describe("classifyCaptureEdge", () => {
  it("classifies modifier edges, confirm/escape down, and non-modifier down only", () => {
    expect(
      classifyCaptureEdge({ key: MAC_RIGHT_CTRL, down: true, repeat: false, flags: 0 }, "mac"),
    ).toEqual({ kind: "modifier", modifier: "RightCtrl", down: true });
    expect(
      classifyCaptureEdge({ key: WIN_RIGHT_CTRL, down: false, repeat: false, flags: 0 }, "windows"),
    ).toEqual({ kind: "modifier", modifier: "RightCtrl", down: false });
    expect(
      classifyCaptureEdge({ key: MAC_ESCAPE, down: true, repeat: false, flags: 0 }, "mac"),
    ).toEqual({ kind: "escape" });
    expect(
      classifyCaptureEdge({ key: WIN_ESCAPE, down: true, repeat: false, flags: 0 }, "windows"),
    ).toEqual({ kind: "escape" });
    expect(
      classifyCaptureEdge({ key: MAC_RETURN, down: true, repeat: false, flags: 0 }, "mac"),
    ).toEqual({ kind: "confirm" });
    expect(
      classifyCaptureEdge({ key: WIN_RETURN, down: true, repeat: false, flags: 0 }, "windows"),
    ).toEqual({ kind: "confirm" });
    expect(
      classifyCaptureEdge({ key: MAC_A, down: true, repeat: false, flags: 0 }, "mac"),
    ).toEqual({ kind: "other" });
    expect(
      classifyCaptureEdge({ key: MAC_A, down: false, repeat: false, flags: 0 }, "mac"),
    ).toBeNull();
  });
});
