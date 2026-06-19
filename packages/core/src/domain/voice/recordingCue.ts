// Recording-cue gate (pure play-once guard for the start/stop earcons).
//
// The app plays a short cue when recording REALLY starts and another when it
// REALLY stops. "Really" matters: a hotkey press or a ✓ click is not proof the
// microphone opened (permission can be denied), and a stop can arrive twice (the
// button and the hotkey both route to the same finish path). Binding the cues to
// UI events would double-play or mis-play.
//
// This gate is the single source of play-once truth. The renderer calls it from
// the actual capture-lifecycle outcomes (mic.start() resolved → started; mic.stop()
// resolved → stopped; cancel/error → abort) and only plays the cue the gate hands
// back. It is a tiny pure state machine so the ordering rules are unit-tested
// without any audio.

export type RecordingCue = "start" | "stop";

export class RecordingCueGate {
  private recording = false;

  /**
   * The microphone has truly opened. Returns "start" exactly on the idle→recording
   * edge; returns null if we were already recording (no double start cue).
   */
  onRecordingStarted(): RecordingCue | null {
    if (this.recording) return null;
    this.recording = true;
    return "start";
  }

  /**
   * The recording truly stopped (user finished). Returns "stop" exactly on the
   * recording→idle edge; returns null if we were not recording (no stop cue
   * without a start, and no double stop on a repeated finish).
   */
  onRecordingStopped(): RecordingCue | null {
    if (!this.recording) return null;
    this.recording = false;
    return "stop";
  }

  /**
   * Recording ended abnormally (cancel / capture error). Clears the recording
   * state WITHOUT yielding a cue — an abort is silent, and a later spurious stop
   * is then correctly suppressed.
   */
  abort(): void {
    this.recording = false;
  }

  /** Whether a recording is currently considered in-flight. */
  get isRecording(): boolean {
    return this.recording;
  }
}
