// Pure-TS port of soto_hotkey::HotkeySessionCoordinator. Toggle-only: a press
// starts a session, a second press of the SAME mode completes it. Releases are
// ignored, and a press for a different mode while one is active is ignored.
// The chord->mode resolution happens upstream (ChordMatcher); this coordinator
// only sees the mode id and the press/release phase.

export type HotkeyPhase = "pressed" | "released";

export interface HotkeyEvent {
  phase: HotkeyPhase;
  modeId: string;
}

export type HotkeySessionAction =
  | { type: "start"; modeId: string }
  | { type: "complete"; modeId: string }
  | { type: "cancel"; modeId: string }
  | { type: "ignore" };

export class HotkeySessionCoordinator {
  private active: string | null = null;

  activeModeId(): string | null {
    return this.active;
  }

  handleEvent(event: HotkeyEvent): HotkeySessionAction {
    if (event.phase === "released") return { type: "ignore" };
    return this.toggle(event.modeId);
  }

  /** Cancel the active session (e.g. Escape), if any. */
  cancelActive(): HotkeySessionAction {
    if (this.active === null) return { type: "ignore" };
    const modeId = this.active;
    this.active = null;
    return { type: "cancel", modeId };
  }

  /**
   * Return to idle without emitting an action. Used when the downstream
   * worker CONSUMED a start gesture without starting a session (e.g. the
   * chord dismissed a lingering notice): toggle() already set `active`, so
   * without this reset the next press would read as `complete` and be
   * silently dropped — costing the user a gesture.
   */
  reset(): void {
    this.active = null;
  }

  private toggle(modeId: string): HotkeySessionAction {
    if (this.active !== null) {
      // A press for a different mode while one is active is ignored.
      if (this.active !== modeId) return { type: "ignore" };
      this.active = null;
      return { type: "complete", modeId };
    }
    this.active = modeId;
    return { type: "start", modeId };
  }
}
