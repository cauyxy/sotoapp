import { afterEach, describe, expect, it, vi } from "vitest";

import type { RawAxStruct, SotoNativeAbi } from "./koffiAbi.js";
import {
  buildFacilities,
  nativeBridgeFromFacilities,
  nativeHotkeyEventLoggingEnabled,
  nativeTextAttemptResultForRaw,
  normalizeMacModifierEdge,
} from "./koffiBridge.js";

const MAC_RIGHT_ALT = 0x3d;
const MAC_A = 0x00;
const MAC_ALTERNATE_FLAG = 0x80000;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("normalizeMacModifierEdge", () => {
  it("re-derives mac modifier down/up from the event flags so a stale native toggle self-heals", () => {
    expect(
      normalizeMacModifierEdge({
        key: MAC_RIGHT_ALT,
        down: false,
        repeat: false,
        flags: MAC_ALTERNATE_FLAG,
      }),
    ).toEqual({
      key: MAC_RIGHT_ALT,
      down: true,
      repeat: false,
      flags: MAC_ALTERNATE_FLAG,
    });

    expect(
      normalizeMacModifierEdge({
        key: MAC_RIGHT_ALT,
        down: true,
        repeat: false,
        flags: 0,
      }),
    ).toEqual({ key: MAC_RIGHT_ALT, down: false, repeat: false, flags: 0 });
  });

  it("leaves non-modifier key events unchanged", () => {
    expect(
      normalizeMacModifierEdge({
        key: MAC_A,
        down: true,
        repeat: false,
        flags: 0,
      }),
    ).toEqual({ key: MAC_A, down: true, repeat: false, flags: 0 });
  });
});

describe("nativeHotkeyEventLoggingEnabled", () => {
  it("keeps raw hotkey event logging opt-in because it is key activity metadata", () => {
    expect(nativeHotkeyEventLoggingEnabled({})).toBe(false);
    expect(nativeHotkeyEventLoggingEnabled({ SOTO_LOG_PROFILE: "smoke" })).toBe(false);
    expect(nativeHotkeyEventLoggingEnabled({ SOTO_LOG_HOTKEY_EVENTS: "1" })).toBe(true);
  });
});

describe("buildFacilities", () => {
  it("maps raw native paste attempt codes into detailed result objects", () => {
    expect(nativeTextAttemptResultForRaw("darwin", "send_paste", -4)).toEqual({
      ok: false,
      operation: "send_paste",
      status: "protected",
      detail: "secure_event_input",
      platform_code: -4,
    });
    expect(nativeTextAttemptResultForRaw("win32", "send_paste", -10)).toEqual({
      ok: false,
      operation: "send_paste",
      status: "error",
      detail: "event_post_failed",
      platform_code: -10,
    });
    expect(nativeTextAttemptResultForRaw("win32", "send_paste", -98)).toEqual({
      ok: false,
      operation: "send_paste",
      status: "unavailable",
      detail: "symbol_unavailable",
      platform_code: -98,
    });
    expect(nativeTextAttemptResultForRaw("win32", "send_paste", -100)).toEqual({
      ok: false,
      operation: "send_paste",
      status: "error",
      detail: "native_exception",
      platform_code: -100,
    });
    expect(nativeTextAttemptResultForRaw("darwin", "send_paste", null)).toEqual({
      ok: false,
      operation: "send_paste",
      status: "unavailable",
      detail: "symbol_unavailable",
      platform_code: null,
    });
    expect(nativeTextAttemptResultForRaw("darwin", "send_paste", 42)).toEqual({
      ok: false,
      operation: "send_paste",
      status: "error",
      detail: "unknown",
      platform_code: 42,
    });
  });

  it("injection facility exposes only the paste-path surface", () => {
    const facilities = buildFacilities(
      fakeAbi({
        sendPaste: () => -11,
      }),
    );

    expect(Object.keys(facilities.injection).sort()).toEqual(
      [
        "activateApp",
        "clipboardCapture",
        "clipboardGet",
        "clipboardRestore",
        "clipboardSet",
        "clipboardSetTransient",
        "clipboardSnapshotKind",
        "frontmostApp",
        "frontmostWindowBounds",
        "probeFocus",
        "probeFocusAsync",
        "sendPaste",
        "sendPasteDetailed",
      ].sort(),
    );
    expect(Object.keys(facilities.ax).sort()).toEqual(
      ["captureFocused", "isTrusted", "probeFocus", "windowTitle"].sort(),
    );
  });

  it("does not perform UIA focused-element queries on Windows (window name only)", async () => {
    const facilities = buildFacilities(
      fakeAbi({
        nativePlatform: "win32",
        focusProbe: () => {
          throw new Error("UIA focus probe must not run on Windows");
        },
        focusProbeAsync: async () => {
          throw new Error("UIA focus probe must not run on Windows");
        },
        axCaptureFocusedAsync: async () => {
          throw new Error("UIA capture must not run on Windows");
        },
        frontmostWindowTitleRawAsync: async () => "Doc — Chrome",
      }),
    );

    expect(await facilities.ax.captureFocused()).toBeNull();
    expect(await facilities.ax.probeFocus()).toBe("unknown");
    expect(facilities.injection.probeFocus()).toBe("unknown");
    expect(await facilities.injection.probeFocusAsync?.()).toBe("unknown");
    // The window/app NAME still comes through the non-UIA GetWindowText path.
    expect(await facilities.ax.windowTitle()).toBe("Doc — Chrome");
  });

  it("surfaces the native mute write result instead of swallowing it", () => {
    const ok = buildFacilities(fakeAbi({ audioSetOutputMuted: () => true }));
    expect(ok.audioMute.setOutputMuted(true)).toBe(true);

    const failed = buildFacilities(fakeAbi({ audioSetOutputMuted: () => false }));
    expect(failed.audioMute.setOutputMuted(true)).toBe(false);
  });

  it("maps native clipboard product operation codes for the injection lease", () => {
    const calls: string[] = [];
    const facilities = buildFacilities(
      fakeAbi({
        clipboardPreparePasteText: (utf8) => {
          calls.push(`prepare:${utf8.toString("utf8")}`);
          return -21;
        },
        clipboardRestoreAfterPaste: () => {
          calls.push("restore");
          return 0;
        },
        clipboardCopyUserText: (utf8) => {
          calls.push(`copy:${utf8.toString("utf8")}`);
          return 0;
        },
      }),
    );

    expect(facilities.injection.clipboardPreparePasteText?.("payload")).toBe("unrestorable");
    expect(facilities.injection.clipboardRestoreAfterPaste?.()).toBe("ok");
    expect(facilities.injection.clipboardCopyUserText?.("copy")).toBe(true);
    expect(calls).toEqual(["prepare:payload", "restore", "copy:copy"]);
  });

  it("maps native clipboard product busy and generic failures distinctly", () => {
    const busy = buildFacilities(
      fakeAbi({
        clipboardPreparePasteText: () => -20,
        clipboardRestoreAfterPaste: () => -21,
        clipboardCopyUserText: () => -1,
      }),
    );
    const failed = buildFacilities(
      fakeAbi({
        clipboardPreparePasteText: () => -1,
      }),
    );

    expect(busy.injection.clipboardPreparePasteText?.("payload")).toBe("busy");
    expect(busy.injection.clipboardRestoreAfterPaste?.()).toBe("unrestorable");
    expect(busy.injection.clipboardCopyUserText?.("copy")).toBe(false);
    expect(failed.injection.clipboardPreparePasteText?.("payload")).toBe("failed");
  });

  it("maps native focus probe timeout code to the timeout status", async () => {
    const facilities = buildFacilities(
      fakeAbi({
        focusProbe: () => 6,
        focusProbeAsync: async () => 6,
      }),
    );

    expect(facilities.injection.probeFocus()).toBe("timeout");
    await expect(facilities.injection.probeFocusAsync?.()).resolves.toBe("timeout");
    await expect(facilities.ax.probeFocus()).resolves.toBe("timeout");
  });

  it("reports AX focus probe timeout when the provider single-flight gate is busy", async () => {
    const facilities = buildFacilities(
      fakeAbi({
        axCaptureFocusedAsync: () => new Promise<RawAxStruct | null>(() => {}),
      }),
    );

    void facilities.ax.captureFocused();

    await expect(facilities.ax.probeFocus()).resolves.toBe("timeout");
  });

  it("returns whether native permission settings opened", () => {
    const opened = nativeBridgeFromFacilities(
      buildFacilities(
        fakeAbi({
          openPermissionSettings: () => true,
        }),
      ),
    );
    const notOpened = nativeBridgeFromFacilities(
      buildFacilities(
        fakeAbi({
          openPermissionSettings: () => false,
        }),
      ),
    );

    expect(opened.openPermissionSettings("accessibility")).toBe(true);
    expect(notOpened.openPermissionSettings("accessibility")).toBe(false);
  });

  it("runs AX capture through the async ABI and fails closed while a native capture is in flight", async () => {
    const resolveCapture: { current?: (raw: RawAxStruct | null) => void } = {};
    const raw: RawAxStruct = {
      full_text: "hello",
      selection_start: 0,
      selection_end: 5,
      before: "",
      after: "",
      ax_role: "TextPattern",
      focused_element_id: "uia.1",
    };
    const facilities = buildFacilities(
      fakeAbi({
        axCaptureFocusedAsync: () =>
          new Promise((resolve) => {
            resolveCapture.current = resolve;
          }),
      }),
    );

    const first = facilities.ax.captureFocused();
    const second = await facilities.ax.captureFocused();

    expect(second).toBeNull();
    if (resolveCapture.current === undefined) {
      throw new Error("capture promise was not started");
    }
    resolveCapture.current(raw);
    await expect(first).resolves.toMatchObject({
      full_text: "hello",
      selection_start: 0,
      selection_end: 5,
      ax_role: "TextPattern",
      focused_element_id: "uia.1",
    });
  });

  it("drains queued Windows hotkey events and logs dropped counts without raw key logging", async () => {
    vi.useFakeTimers();
    vi.stubEnv("SOTO_LOG_HOTKEY_EVENTS", "");

    const logs: Array<[level: "debug" | "warn", message: string]> = [];
    const events = [
      {
        flags: 0b0010,
        key: 0xa3,
        scanCode: 0x1d,
        down: true,
        repeat: false,
        droppedCount: 3,
      },
    ];
    const delivered: unknown[] = [];
    const facilities = buildFacilities(
      fakeAbi({
        nativePlatform: "win32",
        hookInstall: (callback) => {
          expect(callback).toBeNull();
          return {};
        },
        nextHookEvent: () => events.shift() ?? null,
      }),
      (level, message) => logs.push([level, message]),
    );

    expect(facilities.hotkey.supportsSuppression).toBe(false);
    expect(
      facilities.hotkey.install((event) => {
        delivered.push(event);
        return false;
      }),
    ).toBe(true);
    await vi.advanceTimersByTimeAsync(8);
    facilities.hotkey.shutdown();

    expect(delivered).toEqual([
      {
        flags: 0b0010,
        key: 0xa3,
        scanCode: 0x1d,
        down: true,
        repeat: false,
        droppedCount: 3,
      },
    ]);
    expect(logs).toEqual([
      ["warn", "[native] hotkey event queue dropped 3 event(s) before this drain"],
    ]);
  });
});

function fakeAbi(overrides: Partial<SotoNativeAbi> = {}): SotoNativeAbi {
  return {
    nativePlatform: "darwin",
    hookInstall: () => ({}),
    hookShutdown: () => 0,
    nextHookEvent: () => null,
    focusProbe: () => 1,
    focusProbeAsync: async () => 1,
    sendPaste: () => 0,
    clipboardReadText: () => "",
    clipboardWriteText: () => 0,
    clipboardSnapshotKind: () => 0,
    clipboardCapture: () => 0,
    clipboardRestore: () => 0,
    clipboardSetTransient: () => 0,
    axIsTrusted: () => true,
    axCaptureFocused: () => null,
    axCaptureFocusedAsync: async () => null,
    frontmostPid: () => 42,
    frontmostBundleId: () => "com.example.Target",
    frontmostLocalizedName: () => "Target",
    frontmostWindowBoundsRaw: () => null,
    frontmostWindowTitleRaw: () => null,
    frontmostWindowTitleRawAsync: async () => null,
    activateApp: () => 0,
    permissionStatusKind: () => 3,
    requestPermissionKind: () => 3,
    audioIsOutputMuted: () => false,
    audioSetOutputMuted: () => true,
    ...overrides,
  };
}
