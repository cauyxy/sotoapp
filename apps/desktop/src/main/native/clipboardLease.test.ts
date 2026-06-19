import { describe, expect, it } from "vitest";
import type { ClipboardSnapshotKind } from "@soto/core";
import type { InjectionNativePort } from "@soto/native-bridge";
import { ClipboardLease } from "./clipboardLease.js";

function makeNative(kind: ClipboardSnapshotKind = "text") {
  const writes: string[] = [];
  let clipboard = "prior";
  let capturedClipboard = "";
  const native = {
    clipboardSnapshotKind: () => kind,
    clipboardCapture: () => {
      writes.push("capture");
      capturedClipboard = clipboard;
      return true;
    },
    clipboardRestore: () => {
      writes.push("restore");
      clipboard = capturedClipboard;
      return true;
    },
    clipboardGet: () => clipboard,
    clipboardSet: (text: string) => {
      writes.push(`set:${text}`);
      clipboard = text;
    },
    clipboardSetTransient: (text: string) => {
      writes.push(`transient:${text}`);
      clipboard = text;
    },
  } as InjectionNativePort;
  return {
    native,
    writes,
    getClipboard: () => clipboard,
  };
}

describe("ClipboardLease", () => {
  it("serializes active paste leases", () => {
    const { native, writes } = makeNative();
    const lease = new ClipboardLease(native);

    const first = lease.acquirePaste("payload");
    const second = lease.acquirePaste("second");

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, reason: "clipboard_busy" });
    expect(lease.copyOnly("copy")).toBe(false);

    if (first.ok) first.lease.releaseKeepingPayload();
    expect(lease.copyOnly("copy")).toBe(true);
    expect(writes).toEqual(["capture", "transient:payload", "transient:copy"]);
  });

  it("restores the saved text clipboard and releases the lease", () => {
    const { native, getClipboard } = makeNative();
    const lease = new ClipboardLease(native);

    const active = lease.acquirePaste("payload");
    if (active.ok) active.lease.restore();

    expect(getClipboard()).toBe("prior");
    expect(lease.acquirePaste("next").ok).toBe(true);
  });

  it("denies paste when the clipboard snapshot is rich", () => {
    const { native, writes } = makeNative("rich");
    const lease = new ClipboardLease(native);

    expect(lease.acquirePaste("payload")).toEqual({
      ok: false,
      reason: "clipboard_unrestorable",
    });
    expect(writes).toEqual([]);
  });

  it("aborts paste without writing when native capture fails", () => {
    const { native, writes, getClipboard } = makeNative("text");
    native.clipboardCapture = () => {
      writes.push("capture");
      return false;
    };
    const lease = new ClipboardLease(native);

    expect(lease.acquirePaste("payload")).toEqual({
      ok: false,
      reason: "clipboard_unrestorable",
    });
    expect(writes).toEqual(["capture"]);
    expect(getClipboard()).toBe("prior");
  });

  it("uses native clipboard product ops when available", () => {
    const { native, writes } = makeNative("rich");
    native.clipboardPreparePasteText = (text) => {
      writes.push(`prepare:${text}`);
      return "ok";
    };
    native.clipboardRestoreAfterPaste = () => {
      writes.push("restore_after_paste");
      return "ok";
    };
    native.clipboardCopyUserText = (text) => {
      writes.push(`copy_user:${text}`);
      return true;
    };
    const lease = new ClipboardLease(native);

    const active = lease.acquirePaste("payload");
    expect(active.ok).toBe(true);
    if (active.ok) active.lease.restore();
    expect(lease.copyOnly("copy")).toBe(true);

    expect(writes).toEqual(["prepare:payload", "restore_after_paste", "copy_user:copy"]);
  });

  it("maps native clipboard product-op blocks without falling back to split writes", () => {
    const { native, writes } = makeNative("text");
    native.clipboardPreparePasteText = (text) => {
      writes.push(`prepare:${text}`);
      return text === "busy" ? "busy" : "unrestorable";
    };
    native.clipboardRestoreAfterPaste = () => {
      writes.push("restore_after_paste");
      return "ok";
    };
    const lease = new ClipboardLease(native);

    expect(lease.acquirePaste("busy")).toEqual({ ok: false, reason: "clipboard_busy" });
    expect(lease.acquirePaste("rich")).toEqual({
      ok: false,
      reason: "clipboard_unrestorable",
    });

    expect(writes).toEqual(["prepare:busy", "prepare:rich"]);
  });
});
