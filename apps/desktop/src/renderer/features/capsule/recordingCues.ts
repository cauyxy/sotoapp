// Recording cue player (renderer-side, decoupled playback channel).
//
// Plays the original start/stop earcons (./cues/*.wav). This is the app's single
// recording-cue entry point. Key properties:
//
//  - Bound to REAL capture lifecycle, not UI events: the caller invokes started()
//    only after the mic actually opened and stopped() only after it actually
//    closed (see useCaptureDriver). Permission-denied / never-started paths never
//    reach started(), so the start cue can't mis-fire.
//  - Play-once via the pure RecordingCueGate (no double start/stop, no stop
//    without a start; abort() ends silently).
//  - Failure-isolated: every audio call is wrapped so a blocked/missing audio
//    device can never throw into recording, transcription, the Panel, or the
//    capsule state.
//  - Decoupled from the media-mute: these are renderer HTMLAudio elements, and
//    the caller time-separates them from the main-process device mute (start cue
//    rings out BEFORE media is muted; stop cue plays AFTER media is unmuted), so
//    muting background media never silences our own cues.

import { RecordingCueGate, type RecordingCue } from "@soto/core";

import startCueUrl from "./cues/start.wav";
import stopCueUrl from "./cues/stop.wav";

/**
 * How long to let the start cue ring out before the main process mutes media.
 * Slightly longer than the generated start.wav (~480ms) so it is never clipped.
 */
export const CUE_LEAD_MS = 520;

// Soft, low volume — the cues are gentle confirmations, not alerts.
const CUE_VOLUME = 0.4;

function makeAudio(url: string): HTMLAudioElement | null {
  try {
    const audio = new Audio(url);
    audio.volume = CUE_VOLUME;
    audio.preload = "auto";
    return audio;
  } catch {
    return null;
  }
}

export interface RecordingCuePlayer {
  /** The microphone truly opened — play the start cue (once). */
  started(): void;
  /** The recording truly stopped — play the stop cue (once). */
  stopped(): void;
  /** Recording ended abnormally (cancel / error) — clear state, play nothing. */
  abort(): void;
}

export function createRecordingCuePlayer(): RecordingCuePlayer {
  const gate = new RecordingCueGate();
  const startAudio = makeAudio(startCueUrl);
  const stopAudio = makeAudio(stopCueUrl);

  const play = (cue: RecordingCue | null): void => {
    if (cue === null) return; // gate suppressed it (duplicate / out-of-order)
    const element = cue === "start" ? startAudio : stopAudio;
    if (element === null) return;
    try {
      element.currentTime = 0;
      // play() can reject (autoplay policy, no device); swallow — cues are cosmetic.
      void element.play().catch(() => undefined);
    } catch {
      /* never propagate into the recording flow */
    }
  };

  return {
    started: () => play(gate.onRecordingStarted()),
    stopped: () => play(gate.onRecordingStopped()),
    abort: () => gate.abort(),
  };
}

// Process-wide singleton for the capsule window: one player (one pair of Audio
// elements, one gate). Lazy so the Audio elements are only built on first use.
// Exposed as a stable module function so React callbacks can call it without
// listing it as a dependency.
let shared: RecordingCuePlayer | null = null;
export function recordingCues(): RecordingCuePlayer {
  return (shared ??= createRecordingCuePlayer());
}
