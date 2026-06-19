// Media-mute coordinator (pure save/restore state machine).
//
// While the user is dictating, the app temporarily mutes other media output so a
// playing video/song does not bleed into the recording — WITHOUT pausing it and
// WITHOUT changing the master volume LEVEL. The native layer only toggles the
// output device's *mute flag* (CoreAudio kAudioDevicePropertyMute on macOS;
// IAudioEndpointVolume SetMute on Windows), so unmuting restores the exact prior
// level. This coordinator owns the WHEN/save/restore so the rules are testable
// without any OS audio:
//
//  - engage() saves the prior mute state ONCE and mutes. Calling it again while
//    already engaged is a no-op (no stacking across rapid repeat triggers).
//  - release() restores the saved prior state and disengages. Idempotent — safe
//    to call from every terminal path (finish / cancel / error / background /
//    quit) without double-restoring.
//  - If the user had already muted output themselves, we neither re-mute nor
//    later unmute them: their state is preserved untouched.
//
// All port calls are wrapped so a flaky native layer can never throw into the
// recording flow (mute is best-effort; recording/transcription must not break).

/** The native mute capability, injected so the coordinator stays pure + testable. */
export interface MutePort {
  /** Current output mute flag. */
  isMuted(): boolean;
  /** Set the output mute flag. */
  setMuted(muted: boolean): void;
}

export class MediaMuteCoordinator {
  private engaged = false;
  /** Prior device mute state captured at engage time; null when not engaged. */
  private priorMuted: boolean | null = null;

  constructor(private readonly port: MutePort) {}

  get isEngaged(): boolean {
    return this.engaged;
  }

  /** Mute media for a recording. No-op if already engaged (no stacking). */
  engage(): void {
    if (this.engaged) return;
    this.engaged = true;

    let prior: boolean;
    try {
      prior = this.port.isMuted();
    } catch {
      // Could not read prior state — assume unmuted so release() will unmute.
      prior = false;
    }
    this.priorMuted = prior;

    // The user already had output muted → leave everything exactly as-is.
    if (prior) return;
    try {
      this.port.setMuted(true);
    } catch {
      /* best-effort: a failed mute must not break recording */
    }
  }

  /** Restore the prior state. Idempotent; safe on every terminal path. */
  release(): void {
    if (!this.engaged) return;
    const prior = this.priorMuted;
    this.engaged = false;
    this.priorMuted = null;

    // We only ever changed state when prior was "unmuted"; restore to that.
    if (prior === true) return; // user's own mute — leave it muted.
    try {
      this.port.setMuted(false);
    } catch {
      /* best-effort */
    }
  }
}
