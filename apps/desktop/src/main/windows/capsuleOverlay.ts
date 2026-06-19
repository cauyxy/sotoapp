// Capsule overlay visibility (plan §5 / focus protection). The capsule must
// appear without stealing key focus from the target app (the injection path
// pastes into whatever stays frontmost), and hide shortly after a session ends
// so a completed result is briefly visible. A monotonic show epoch lets a
// fresh session's show cancel a stale pending hide (rapid start/stop must not
// hide a new session). Mirrors the deleted previous desktop shell sink's
// show_epoch + hide_capsule_after_delay.

import { screen, type BrowserWindow } from "electron";
import { computeCapsuleBounds } from "./capsulePosition.pure.js";

// Enlarged transparent overlay (matches createCapsuleWindow): the pill is
// anchored near the bottom of this frame and the Panel stacks above it.
const CAPSULE_WIDTH = 360;
const CAPSULE_HEIGHT = 200;
// Vertical placement is computed from the visible pill bottom in
// capsulePosition.pure.ts. Keep those constants there so the math can account
// for the renderer's 8px bottom padding and display-specific Dock/taskbar insets.
/** Delay before hiding so a completed/cancelled result stays briefly visible. */
const CAPSULE_HIDE_DELAY_MS = 350;

export type CapsuleExitIntent =
  | "success"
  | "cancel"
  | "error"
  | "notice"
  | "default";

/** One-way pushes to the capsule renderer announcing window choreography. */
export type CapsuleOverlayPush =
  | { kind: "will-show"; seq: number }
  | { kind: "will-hide"; seq: number; in_ms: number; exit: CapsuleExitIntent };

/** Floor for a hide rescheduled after a hover-pause, so the user can re-read. */
const RESUME_HIDE_FLOOR_MS = 1500;

/**
 * Owns the capsule window's show/hide lifecycle: positioning, the deferred
 * hide + epoch guard, and the macOS activation-policy dance. The window handle
 * is read through a getter because the capsule window can be recreated.
 */
export class CapsuleOverlay {
  private showEpoch = 0;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private hideDeadline = 0;
  private pausedHide: { remainingMs: number; exit: CapsuleExitIntent } | null = null;
  private pendingExit: CapsuleExitIntent = "default";

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly push: (event: CapsuleOverlayPush) => void = () => {},
    // True when the app the capsule is about to overlay is in a full-screen
    // Space. The Dock-dropping UIElement (accessory) switch is ONLY needed
    // there — macOS full-screen Spaces won't admit a regular app's auxiliary
    // window onscreen. On the regular desktop the Dock is visible and toggling
    // the activation policy is a jarring icon flicker with no benefit; in
    // full-screen the Dock is already auto-hidden, so the switch is invisible.
    private readonly isFrontmostFullScreen: () => boolean = () => false,
    private readonly setCapsuleAccessoryNeeded: (active: boolean) => void = () => {},
  ) {}

  /**
   * Show or hide the capsule overlay. Show positions + showInactive() (never
   * .show()/.focus(), which would activate Electron and pull focus from the
   * target app); hide is deferred so a result lingers, with the epoch guarding
   * against hiding a session that started in the meantime.
   */
  setVisible(
    visible: boolean,
    lingerMs?: number,
    exit: CapsuleExitIntent = "default",
  ): void {
    const win = this.getWindow();
    if (win === null || win.isDestroyed()) return;

    if (visible) {
      this.show(false);
      return;
    }

    this.scheduleHide(lingerMs ?? CAPSULE_HIDE_DELAY_MS, exit);
  }

  setInteractive(interactive: boolean): void {
    const win = this.getWindow();
    if (win === null || win.isDestroyed()) return;
    const maybeInteractive = win as BrowserWindow & {
      setIgnoreMouseEvents?: BrowserWindow["setIgnoreMouseEvents"];
    };
    maybeInteractive.setIgnoreMouseEvents?.(!interactive, { forward: true });
  }

  /** Hover-enter on the Panel: freeze the pending hide (no-op when none). */
  pauseHide(): void {
    if (this.hideTimer === null) return;
    clearTimeout(this.hideTimer);
    this.hideTimer = null;
    this.pausedHide = {
      remainingMs: Math.max(0, this.hideDeadline - Date.now()),
      exit: this.pendingExit,
    };
  }

  /** Hover-leave: reschedule with a re-read floor and re-announce the exit. */
  resumeHide(): void {
    if (this.pausedHide === null) return;
    const paused = this.pausedHide;
    const remaining = Math.max(paused.remainingMs, RESUME_HIDE_FLOOR_MS);
    this.pausedHide = null;
    this.scheduleHide(remaining, paused.exit);
  }

  /**
   * Whether a hide is pending — scheduled OR hover-paused. The single source
   * of truth for "the overlay is lingering on screen" (a live recording
   * schedules no hide, so this is false mid-session). Mirrors expediteHide's
   * dual handling of the paused state.
   */
  hasPendingHide(): boolean {
    return this.hideTimer !== null || this.pausedHide !== null;
  }

  /**
   * User dismissed the notice: accelerate an existing or paused hide down to
   * toMs. STRICT NO-OP when none is pending (an active recording schedules no
   * hide — pauseHide relies on the same invariant — so a stray dismiss can
   * never hide a live session). min() only ever shortens. Bypasses
   * RESUME_HIDE_FLOOR_MS: the user asked it to go. scheduleHide re-pushes
   * will-hide so the renderer re-times its sink exit, and captures the epoch
   * so a newer show cancels the expedited hide.
   */
  expediteHide(toMs: number = CAPSULE_HIDE_DELAY_MS): void {
    if (this.pausedHide !== null) {
      const paused = this.pausedHide;
      const next = Math.min(paused.remainingMs, toMs);
      this.pausedHide = null;
      this.scheduleHide(next, paused.exit);
      return;
    }
    if (this.hideTimer === null) return;
    this.scheduleHide(
      Math.min(Math.max(0, this.hideDeadline - Date.now()), toMs),
      this.pendingExit,
    );
  }

  private scheduleHide(lingerMs: number, exit: CapsuleExitIntent): void {
    const epoch = this.showEpoch;
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    this.hideDeadline = Date.now() + lingerMs;
    this.pendingExit = exit;
    this.push({ kind: "will-hide", seq: epoch, in_ms: lingerMs, exit });
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      if (epoch !== this.showEpoch) return;
      const w = this.getWindow();
      if (w !== null && !w.isDestroyed()) {
        const maybeInteractive = w as BrowserWindow & {
          setIgnoreMouseEvents?: BrowserWindow["setIgnoreMouseEvents"];
        };
        maybeInteractive.setIgnoreMouseEvents?.(true, { forward: true });
        w.hide();
      }
      this.pendingExit = "default";
      this.setOverlayActivation(false);
    }, lingerMs);
    if (typeof this.hideTimer.unref === "function") this.hideTimer.unref();
  }

  /** Quit safety net: restore the regular activation policy. */
  restoreActivationPolicy(): void {
    this.setOverlayActivation(false);
  }

  /** Position the capsule bottom-center of the cursor display, Dock/taskbar-safe. */
  private position(win: BrowserWindow): void {
    try {
      const bounds = computeCapsuleBounds({
        displays: screen.getAllDisplays(),
        cursorPoint: screen.getCursorScreenPoint(),
        capsuleSize: { width: CAPSULE_WIDTH, height: CAPSULE_HEIGHT },
      });
      if (bounds !== null) win.setBounds(bounds);
    } catch {
      // screen module unavailable (shouldn't happen post-ready) — leave as-is.
    }
  }

  private show(interactive: boolean): void {
    const win = this.getWindow();
    if (win === null || win.isDestroyed()) return;
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    this.pausedHide = null;
    this.pendingExit = "default";
    this.showEpoch += 1;
    const epoch = this.showEpoch;
    this.push({ kind: "will-show", seq: epoch });
    this.position(win);
    this.setInteractive(interactive);
    const reveal = setTimeout(() => {
      if (epoch !== this.showEpoch) return;
      const w = this.getWindow();
      if (w === null || w.isDestroyed()) return;
      this.setOverlayActivation(this.isFrontmostFullScreen());
      w.setAlwaysOnTop(true, "screen-saver");
      w.showInactive();
      w.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true,
      });
      w.moveTop();
    }, 0);
    if (typeof reveal.unref === "function") reveal.unref();
  }

  private setOverlayActivation(active: boolean): void {
    this.setCapsuleAccessoryNeeded(active);
  }
}
