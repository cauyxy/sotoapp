import type { ClipboardSnapshotKind } from "@soto/core";
import type {
  ClipboardProductOperationResult,
  InjectionNativePort,
} from "@soto/native-bridge";

export interface ActiveClipboardLease {
  restore(): void;
  releaseKeepingPayload(): void;
}

export type ClipboardPasteBlockReason = "clipboard_busy" | "clipboard_unrestorable";

export type ClipboardPasteAcquireResult =
  | { ok: true; lease: ActiveClipboardLease }
  | { ok: false; reason: ClipboardPasteBlockReason };

export class ClipboardLease {
  private active = false;

  constructor(private readonly native: InjectionNativePort) {}

  snapshotKind(): ClipboardSnapshotKind {
    try {
      return this.native.clipboardSnapshotKind();
    } catch {
      return "rich";
    }
  }

  copyOnly(text: string): boolean {
    if (this.active) return false;
    try {
      if (this.native.clipboardCopyUserText) {
        return this.native.clipboardCopyUserText(text);
      }
      this.writeTransient(text);
      return true;
    } catch {
      return false;
    }
  }

  acquirePaste(text: string): ClipboardPasteAcquireResult {
    if (this.active) return { ok: false, reason: "clipboard_busy" };
    if (this.native.clipboardPreparePasteText && this.native.clipboardRestoreAfterPaste) {
      return this.acquireProductPaste(text);
    }

    const kind = this.snapshotKind();
    if (kind === "rich") return { ok: false, reason: "clipboard_unrestorable" };

    this.active = true;
    const snapshot = this.captureRestorableSnapshot(kind);
    if (snapshot === null) {
      this.active = false;
      return { ok: false, reason: "clipboard_unrestorable" };
    }

    try {
      this.writeTransient(text);
    } catch (error) {
      snapshot.restore();
      this.active = false;
      throw error;
    }

    let released = false;
    const release = (): boolean => {
      if (released) return false;
      released = true;
      this.active = false;
      return true;
    };

    return {
      ok: true,
      lease: {
        restore: () => {
          if (!release()) return;
          snapshot.restore();
        },
        releaseKeepingPayload: () => {
          release();
          /* payload remains as the recovery artifact */
        },
      },
    };
  }

  private acquireProductPaste(text: string): ClipboardPasteAcquireResult {
    let prepared: ClipboardProductOperationResult;
    try {
      prepared = this.native.clipboardPreparePasteText?.(text) ?? "failed";
    } catch {
      prepared = "failed";
    }

    if (prepared === "busy") return { ok: false, reason: "clipboard_busy" };
    if (prepared === "unrestorable") {
      return { ok: false, reason: "clipboard_unrestorable" };
    }
    if (prepared !== "ok") return { ok: false, reason: "clipboard_busy" };

    this.active = true;
    let released = false;
    const release = (): boolean => {
      if (released) return false;
      released = true;
      this.active = false;
      return true;
    };
    const restore = (): void => {
      try {
        this.native.clipboardRestoreAfterPaste?.();
      } catch {
        /* best-effort restore */
      }
    };

    return {
      ok: true,
      lease: {
        restore: () => {
          if (!release()) return;
          restore();
        },
        releaseKeepingPayload: () => {
          if (!release()) return;
          restore();
        },
      },
    };
  }

  private writeTransient(text: string): void {
    try {
      this.native.clipboardSetTransient(text);
    } catch {
      this.native.clipboardSet(text);
    }
  }

  private captureRestorableSnapshot(
    kind: ClipboardSnapshotKind,
  ): { restore(): void } | null {
    if (this.native.clipboardCapture && this.native.clipboardRestore) {
      try {
        if (!this.native.clipboardCapture()) return null;
      } catch {
        return null;
      }

      return {
        restore: () => {
          try {
            this.native.clipboardRestore?.();
          } catch {
            /* best-effort restore */
          }
        },
      };
    }

    let savedText = "";
    try {
      if (kind === "text") savedText = this.native.clipboardGet();
    } catch {
      savedText = "";
    }

    return {
      restore: () => {
        try {
          this.native.clipboardSet(kind === "empty" ? "" : savedText);
        } catch {
          /* best-effort restore */
        }
      },
    };
  }
}
