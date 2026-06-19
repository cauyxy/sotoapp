import { describe, expect, it } from "vitest";
import type { AppInfo, FocusProbeStatus } from "@soto/core";
import { createPlatformInjector } from "./platformInjector.js";
import type {
  InjectionNativePort,
  NativeTextAttemptOperation,
  NativeTextAttemptResult,
} from "@soto/native-bridge";

const TARGET: AppInfo = { pid: 1, bundleId: "com.target", localizedName: "Target" };
const TERMINAL: AppInfo = { pid: 2, bundleId: "com.googlecode.iterm2", localizedName: "iTerm2" };
const OTHER: AppInfo = { pid: 3, bundleId: "com.other", localizedName: "Other" };
const SESSION_TARGET = { app: null, windowTitle: null, controlType: null };

function attemptOk(operation: NativeTextAttemptOperation): NativeTextAttemptResult {
  return { ok: true, operation, platform_code: 0 };
}

function attemptFailure(
  operation: NativeTextAttemptOperation,
  failure: Extract<NativeTextAttemptResult, { ok: false }>,
): NativeTextAttemptResult {
  return { ...failure, operation };
}

type ProbeAsyncOverride = {
  probeFocusAsync?: () => Promise<FocusProbeStatus>;
};

function makeNative(overrides: Partial<InjectionNativePort> & ProbeAsyncOverride = {}) {
  const calls: string[] = [];
  let clipboard = "USER_CLIPBOARD";
  let capturedClipboard = "";
  const native: InjectionNativePort & ProbeAsyncOverride = {
    probeFocus: () => {
      calls.push("probeFocus");
      return overrides.probeFocus ? overrides.probeFocus() : "not_editable";
    },
    ...(overrides.probeFocusAsync
      ? {
          probeFocusAsync: () => {
            calls.push("probeFocusAsync");
            return overrides.probeFocusAsync!();
          },
        }
      : {}),
    frontmostApp: () => {
      calls.push("frontmostApp");
      return overrides.frontmostApp ? overrides.frontmostApp() : TARGET;
    },
    activateApp: (pid) => {
      calls.push(`activateApp(${pid})`);
      overrides.activateApp?.(pid);
    },
    sendPaste: () => {
      calls.push("sendPaste");
      return overrides.sendPaste ? overrides.sendPaste() : true;
    },
    sendPasteDetailed: () => {
      calls.push("sendPaste");
      if (overrides.sendPasteDetailed) return overrides.sendPasteDetailed();
      const ok = overrides.sendPaste ? overrides.sendPaste() : true;
      return ok
        ? attemptOk("send_paste")
        : attemptFailure("send_paste", {
            ok: false,
            operation: "send_paste",
            status: "error",
            detail: "unknown",
            platform_code: -100,
          });
    },
    clipboardGet: () => {
      calls.push("clipboardGet");
      return overrides.clipboardGet ? overrides.clipboardGet() : clipboard;
    },
    clipboardCapture: () => {
      calls.push("clipboardCapture");
      if (overrides.clipboardCapture) return overrides.clipboardCapture();
      capturedClipboard = clipboard;
      return true;
    },
    clipboardRestore: () => {
      calls.push("clipboardRestore");
      if (overrides.clipboardRestore) return overrides.clipboardRestore();
      clipboard = capturedClipboard;
      return true;
    },
    clipboardSet: (s) => {
      calls.push(`clipboardSet(${JSON.stringify(s)})`);
      if (overrides.clipboardSet) overrides.clipboardSet(s);
      else clipboard = s;
    },
    clipboardSnapshotKind: () => {
      calls.push("clipboardSnapshotKind");
      return overrides.clipboardSnapshotKind ? overrides.clipboardSnapshotKind() : "text";
    },
    clipboardSetTransient: (s) => {
      calls.push(`clipboardSetTransient(${JSON.stringify(s)})`);
      if (overrides.clipboardSetTransient) overrides.clipboardSetTransient(s);
      else clipboard = s;
    },
  };
  return { native, calls, getClipboard: () => clipboard };
}

function injectorFor(native: InjectionNativePort, platform: NodeJS.Platform = "darwin") {
  const sleeps: number[] = [];
  const injector = createPlatformInjector(native, {
    platform,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
  });
  return { injector, sleeps };
}

describe("createPlatformInjector — gates", () => {
  it("runs the empty gate before any delivery attempt", async () => {
    const { native, calls } = makeNative();
    const { injector } = injectorFor(native);

    const outcome = await injector.inject("   \n\t  ", TARGET, SESSION_TARGET);

    expect(outcome).toEqual({ kind: "no_op" });
    expect(calls).toEqual(["probeFocus"]);
  });

  it("pastes when the saved app is current even if the probe reports untrusted", async () => {
    const { native, calls, getClipboard } = makeNative({ probeFocus: () => "untrusted" });
    const { injector } = injectorFor(native);

    const outcome = await injector.inject("hello", TARGET, SESSION_TARGET);

    expect(outcome).toEqual({ kind: "paste_sent", method: "paste" });
    expect(getClipboard()).toBe("USER_CLIPBOARD");
    expect(calls).toContain("sendPaste");
    expect(calls).toContain('clipboardSetTransient("hello")');
  });

  it("panels without touching a rich clipboard for protected Windows targets", async () => {
    const { native, calls, getClipboard } = makeNative({
      probeFocus: () => "blocked_elevated",
      clipboardSnapshotKind: () => "rich",
    });
    const { injector } = injectorFor(native, "win32");

    const outcome = await injector.inject("hello", TARGET, SESSION_TARGET);

    expect(outcome).toEqual({
      kind: "manual_copy_required",
      reason: "clipboard_unrestorable",
    });
    expect(getClipboard()).toBe("USER_CLIPBOARD");
    expect(calls).not.toContain("sendPaste");
    expect(calls).not.toContain('clipboardSetTransient("hello")');
  });

  it("pastes when the saved app is current even if macOS probe reports secure input", async () => {
    const { native, calls, getClipboard } = makeNative({ probeFocus: () => "secure_input" });
    const { injector } = injectorFor(native, "darwin");

    const outcome = await injector.inject("hello", TARGET, SESSION_TARGET);

    expect(outcome).toEqual({ kind: "paste_sent", method: "paste" });
    expect(getClipboard()).toBe("USER_CLIPBOARD");
    expect(calls).toContain("sendPaste");
    expect(calls).toContain('clipboardSetTransient("hello")');
  });

  it("pastes when focus restoration returns to the saved app even if the probe is secure", async () => {
    let frontmostCall = 0;
    let probeCall = 0;
    const { native, calls, getClipboard } = makeNative({
      frontmostApp: () => {
        frontmostCall += 1;
        return frontmostCall === 1 ? OTHER : TARGET;
      },
      probeFocus: () => {
        probeCall += 1;
        return probeCall === 1 ? "editable" : "secure_input";
      },
    });
    const { injector } = injectorFor(native, "darwin");

    const outcome = await injector.inject("hello", TARGET, SESSION_TARGET);

    expect(outcome).toEqual({ kind: "paste_sent", method: "paste" });
    expect(getClipboard()).toBe("USER_CLIPBOARD");
    expect(calls.indexOf("activateApp(1)")).toBeLessThan(calls.lastIndexOf("probeFocus"));
    expect(calls).toContain("sendPaste");
    expect(calls).toContain('clipboardSetTransient("hello")');
  });

  it("logs the pre-paste probe but does not let it block paste", async () => {
    let probeCall = 0;
    const { native, calls, getClipboard } = makeNative({
      probeFocus: () => {
        probeCall += 1;
        return probeCall === 1 ? "editable" : "secure_input";
      },
    });
    const { injector } = injectorFor(native, "darwin");

    const outcome = await injector.inject("hello", TARGET, SESSION_TARGET);

    expect(outcome).toEqual({ kind: "paste_sent", method: "paste" });
    expect(getClipboard()).toBe("USER_CLIPBOARD");
    expect(calls).toContain("sendPaste");
    expect(calls).toContain('clipboardSetTransient("hello")');
    expect(calls.filter((call) => call === "probeFocus").length).toBeGreaterThanOrEqual(2);
  });

  it("pastes when the saved app is restored but AX reports no focused target", async () => {
    let frontmostCall = 0;
    let probeCall = 0;
    const { native, calls, getClipboard } = makeNative({
      frontmostApp: () => {
        frontmostCall += 1;
        return frontmostCall === 1 ? OTHER : TARGET;
      },
      probeFocus: () => {
        probeCall += 1;
        return probeCall === 1 ? "editable" : "no_focus";
      },
    });
    const { injector } = injectorFor(native, "darwin");

    const outcome = await injector.inject("hello", TARGET, SESSION_TARGET);

    expect(outcome).toEqual({ kind: "paste_sent", method: "paste" });
    expect(getClipboard()).toBe("USER_CLIPBOARD");
    expect(calls.indexOf("activateApp(1)")).toBeLessThan(calls.lastIndexOf("probeFocus"));
    expect(calls).toContain("sendPaste");
  });

  it("pastes when the post-focus probe loses AX focus in the same app", async () => {
    let probeCall = 0;
    const { native, calls, getClipboard } = makeNative({
      probeFocus: () => {
        probeCall += 1;
        return probeCall === 1 ? "editable" : "no_focus";
      },
    });
    const { injector } = injectorFor(native, "darwin");

    const outcome = await injector.inject("hello", TARGET, SESSION_TARGET);

    expect(outcome).toEqual({ kind: "paste_sent", method: "paste" });
    expect(getClipboard()).toBe("USER_CLIPBOARD");
    expect(calls).toContain("sendPaste");
  });

  it("pastes into the saved app when AX reports no_focus but the app did not change", async () => {
    const { native, calls, getClipboard } = makeNative({
      probeFocus: () => "no_focus",
    });
    const { injector } = injectorFor(native, "darwin");

    const outcome = await injector.inject("hello", TARGET, SESSION_TARGET);

    expect(outcome).toEqual({ kind: "paste_sent", method: "paste" });
    expect(getClipboard()).toBe("USER_CLIPBOARD");
    expect(calls).toContain("sendPaste");
    expect(calls).toContain('clipboardSetTransient("hello")');
  });
});

describe("createPlatformInjector — focus protection", () => {
  it("protects focus before the first delivery attempt", async () => {
    let frontmostCall = 0;
    const { native, calls } = makeNative({
      frontmostApp: () => {
        frontmostCall += 1;
        return frontmostCall === 1 ? OTHER : TARGET;
      },
    });
    const { injector, sleeps } = injectorFor(native);

    const outcome = await injector.inject("hi", TARGET, SESSION_TARGET);

    expect(outcome).toEqual({ kind: "paste_sent", method: "paste" });
    expect(calls.indexOf("frontmostApp")).toBeLessThan(calls.indexOf("sendPaste"));
    expect(calls).toContain("activateApp(1)");
    expect(sleeps).toContain(50);
  });

  it("returns focus_lost without copying when the target is gone", async () => {
    const { native, calls, getClipboard } = makeNative({ frontmostApp: () => OTHER });
    const { injector } = injectorFor(native);

    const outcome = await injector.inject("hi", TARGET, SESSION_TARGET);

    expect(outcome).toEqual({
      kind: "focus_lost",
      detail: { saved_app_name: "Target", actual_app_name: "Other" },
    });
    expect(getClipboard()).toBe("USER_CLIPBOARD");
    expect(calls).not.toContain('clipboardSetTransient("hi")');
    expect(calls).not.toContain("sendPaste");
  });

  it("does not paste when there is no saved app to compare against", async () => {
    const { native, calls, getClipboard } = makeNative({ probeFocus: () => "editable" });
    const { injector } = injectorFor(native);

    const outcome = await injector.inject("hi", null, SESSION_TARGET);

    expect(outcome).toEqual({ kind: "manual_copy_required", reason: "paste_unverified" });
    expect(getClipboard()).toBe("USER_CLIPBOARD");
    expect(calls).not.toContain("frontmostApp");
    expect(calls).not.toContain("sendPaste");
    expect(calls).not.toContain('clipboardSetTransient("hi")');
  });
});

describe("createPlatformInjector — paste-only delivery", () => {
  it("pastes editable macOS targets without attempting AX", async () => {
    const { native, calls } = makeNative({
      probeFocus: () => "editable",
    });
    const { injector, sleeps } = injectorFor(native);

    const outcome = await injector.inject("hello", TARGET, SESSION_TARGET);

    expect(outcome).toEqual({ kind: "paste_sent", method: "paste" });
    expect(calls).toContain("sendPaste");
    expect(sleeps).toEqual([180]);
  });

  it("does not call detailed AX insertion even when it would deny permission", async () => {
    const { native, calls, getClipboard } = makeNative({
      probeFocus: () => "editable",
    });
    const { injector } = injectorFor(native);

    const outcome = await injector.inject("hello", TARGET, SESSION_TARGET);

    expect(outcome).toEqual({ kind: "paste_sent", method: "paste" });
    expect(getClipboard()).toBe("USER_CLIPBOARD");
    expect(calls).toContain("sendPaste");
  });

  it("uses async Windows focus probing instead of treating sync probe failure as protected", async () => {
    const { native, getClipboard } = makeNative({
      probeFocus: () => "unknown",
      probeFocusAsync: async () => "not_editable",
    });
    const { injector } = injectorFor(native, "win32");

    const outcome = await injector.inject("hello", TARGET, SESSION_TARGET);

    expect(outcome).toEqual({ kind: "paste_sent", method: "paste" });
    expect(getClipboard()).toBe("USER_CLIPBOARD");
  });

  it("pastes when the pre-paste probe is unknown but the saved app is current", async () => {
    let probeCall = 0;
    const { native, calls, getClipboard } = makeNative({
      probeFocus: () => {
        probeCall += 1;
        return probeCall === 1 ? "not_editable" : "unknown";
      },
    });
    const { injector } = injectorFor(native, "win32");

    const outcome = await injector.inject("hello", TARGET, SESSION_TARGET);

    expect(outcome).toEqual({ kind: "paste_sent", method: "paste" });
    expect(getClipboard()).toBe("USER_CLIPBOARD");
    expect(calls).toContain("sendPaste");
  });

  it("does not call detailed protected AX insertion when paste is available", async () => {
    const { native, calls, getClipboard } = makeNative({
      probeFocus: () => "editable",
    });
    const { injector } = injectorFor(native);

    const outcome = await injector.inject("hello", TARGET, SESSION_TARGET);

    expect(outcome).toEqual({ kind: "paste_sent", method: "paste" });
    expect(getClipboard()).toBe("USER_CLIPBOARD");
    expect(calls).toContain("sendPaste");
  });

  it("does not use AX no-focus escalation under paste-only delivery", async () => {
    const { native, calls, getClipboard } = makeNative({
      probeFocus: () => "editable",
    });
    const { injector } = injectorFor(native);

    const outcome = await injector.inject("hello", TARGET, SESSION_TARGET);

    expect(outcome).toEqual({ kind: "paste_sent", method: "paste" });
    expect(getClipboard()).toBe("USER_CLIPBOARD");
    expect(calls).toContain("sendPaste");
  });

  it("does not fall back from AX to typing because AX is not attempted", async () => {
    const { native, calls } = makeNative({
      probeFocus: () => "editable",
    });
    const { injector } = injectorFor(native);

    const outcome = await injector.inject("hello", TARGET, SESSION_TARGET);

    expect(outcome).toEqual({ kind: "paste_sent", method: "paste" });
    expect(calls).toContain("sendPaste");
  });

  it("does not try typed fallback when paste send fails", async () => {
    const { native, calls, getClipboard } = makeNative({
      probeFocus: () => "editable",
      sendPaste: () => false,
    });
    const { injector } = injectorFor(native);

    const outcome = await injector.inject("hello", TARGET, SESSION_TARGET);

    expect(outcome).toEqual({ kind: "manual_copy_required", reason: "paste_send_failed" });
    expect(getClipboard()).toBe("USER_CLIPBOARD");
    expect(calls.indexOf('clipboardSetTransient("hello")')).toBeLessThan(
      calls.indexOf("clipboardRestore"),
    );
  });

  it("pastes terminal dictation without newline normalization", async () => {
    const { native, calls } = makeNative({
      frontmostApp: () => TERMINAL,
    });
    const { injector, sleeps } = injectorFor(native);

    const outcome = await injector.inject("hello\nworld", TERMINAL, SESSION_TARGET);

    expect(outcome).toEqual({ kind: "paste_sent", method: "paste" });
    expect(calls).toContain('clipboardSetTransient("hello\\nworld")');
    expect(sleeps).toEqual([180]);
  });
});

describe("createPlatformInjector — leased paste", () => {
  it("restores the prior clipboard only after paste settle", async () => {
    const { native, getClipboard } = makeNative();
    const { injector, sleeps } = injectorFor(native);

    const outcome = await injector.inject("line 1\nline 2", TARGET, SESSION_TARGET);

    expect(outcome).toEqual({ kind: "paste_sent", method: "paste" });
    expect(getClipboard()).toBe("USER_CLIPBOARD");
    expect(sleeps).toEqual([180]);
  });

  it("denies paste over a rich clipboard without typing fallback", async () => {
    const { native, calls, getClipboard } = makeNative({ clipboardSnapshotKind: () => "rich" });
    const { injector } = injectorFor(native);

    const outcome = await injector.inject("line 1\nline 2", TARGET, SESSION_TARGET);

    expect(outcome).toEqual({ kind: "manual_copy_required", reason: "clipboard_unrestorable" });
    expect(getClipboard()).toBe("USER_CLIPBOARD");
    expect(calls).not.toContain("sendPaste");
  });
});

describe("createPlatformInjector — Windows paste-only", () => {
  it("pastes a short single-line insert and restores the clipboard", async () => {
    const { native, calls, getClipboard } = makeNative({ probeFocus: () => "editable" });
    const { injector } = injectorFor(native, "win32");

    const outcome = await injector.inject("hello there", TARGET, SESSION_TARGET);

    expect(outcome).toEqual({ kind: "paste_sent", method: "paste" });
    expect(calls).toContain("sendPaste");
    expect(calls.indexOf("clipboardCapture")).toBeLessThan(
      calls.indexOf('clipboardSetTransient("hello there")'),
    );
    expect(calls.indexOf("sendPaste")).toBeLessThan(calls.indexOf("clipboardRestore"));
    expect(getClipboard()).toBe("USER_CLIPBOARD");
  });

  it("restores before manual fallback when sending paste fails", async () => {
    const { native, calls, getClipboard } = makeNative({
      probeFocus: () => "editable",
      sendPaste: () => false,
    });
    const { injector } = injectorFor(native, "win32");

    const outcome = await injector.inject("hello there", TARGET, SESSION_TARGET);

    expect(outcome).toEqual({ kind: "manual_copy_required", reason: "paste_send_failed" });
    expect(calls.indexOf('clipboardSetTransient("hello there")')).toBeLessThan(
      calls.indexOf("clipboardRestore"),
    );
    expect(calls.filter((call) => call === 'clipboardSetTransient("hello there")')).toHaveLength(1);
    expect(getClipboard()).toBe("USER_CLIPBOARD");
  });

  it("restores before manual fallback when detailed paste send is incomplete", async () => {
    const { native, calls, getClipboard } = makeNative({
      probeFocus: () => "editable",
      sendPaste: () => {
        throw new Error("legacy sendPaste should not be used");
      },
      sendPasteDetailed: () => ({
        ok: false,
        operation: "send_paste",
        status: "error",
        detail: "send_input_incomplete",
        platform_code: -2,
      }),
    });
    const { injector } = injectorFor(native, "win32");

    const outcome = await injector.inject("hello there", TARGET, SESSION_TARGET);

    expect(outcome).toEqual({ kind: "manual_copy_required", reason: "paste_send_failed" });
    expect(calls.indexOf('clipboardSetTransient("hello there")')).toBeLessThan(
      calls.indexOf("clipboardRestore"),
    );
    expect(calls.filter((call) => call === 'clipboardSetTransient("hello there")')).toHaveLength(1);
    expect(getClipboard()).toBe("USER_CLIPBOARD");
  });

  it("panels without typing when native clipboard capture fails", async () => {
    const { native, calls } = makeNative({
      probeFocus: () => "editable",
      clipboardCapture: () => false,
    });
    const { injector } = injectorFor(native, "win32");

    const outcome = await injector.inject("hello there", TARGET, SESSION_TARGET);

    expect(outcome).toEqual({
      kind: "manual_copy_required",
      reason: "clipboard_unrestorable",
    });
    expect(calls).not.toContain("sendPaste");
    expect(calls).not.toContain('clipboardSetTransient("hello there")');
  });

  it("pastes when Windows reports no_focus but the saved app is current", async () => {
    const { native, calls, getClipboard } = makeNative({ probeFocus: () => "no_focus" });
    const { injector } = injectorFor(native, "win32");

    const outcome = await injector.inject("hello there", TARGET, SESSION_TARGET);

    expect(outcome).toEqual({ kind: "paste_sent", method: "paste" });
    expect(getClipboard()).toBe("USER_CLIPBOARD");
    expect(calls).toContain("sendPaste");
    expect(calls).toContain('clipboardSetTransient("hello there")');
  });

  it("pastes terminal dictation without newline normalization", async () => {
    const { native, calls } = makeNative({
      frontmostApp: () => TERMINAL,
      probeFocus: () => "not_editable",
    });
    const { injector } = injectorFor(native, "win32");

    const outcome = await injector.inject("hello\nworld", TERMINAL, SESSION_TARGET);

    expect(outcome).toEqual({ kind: "paste_sent", method: "paste" });
    expect(calls).toContain('clipboardSetTransient("hello\\nworld")');
  });
});
