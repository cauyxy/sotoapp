// Pure-TS port of the pre-flight gate in soto_app::run_voice_session: skip the
// provider round-trip when a recording is too short or silent. Ordering is
// duration-then-silence; comparisons are strict `<` at their thresholds so exact
// threshold values pass through.

/** Minimum recording length; anything shorter is rejected as too_short. */
export const MIN_RECORDING_MS = 300;

/** Peak below which the whole recording is treated as silent (~-50 dBFS). */
export const SILENCE_PEAK_THRESHOLD = 0.003;

/** Minimum detected speech duration for dictation recordings. */
export const MIN_VOICED_MS = 250;

export type EmptyReason = "too_short" | "silent";

export type RecordingValidation =
  | { accepted: true }
  | { accepted: false; reason: EmptyReason };

export interface RecordingMeasurements {
  durationMs: number;
  peak: number;
  voicedMs: number;
}

export interface ValidateRecordingOptions {
  /**
   * Skip the silence (peak) check. Used by voice *commands*, where a base-only
   * command legitimately has no speech. The too_short floor is still enforced
   * as an accidental-double-tap guard.
   */
  allowSilent?: boolean;
  minVoicedMs?: number;
}

export function validateRecording(
  measurements: RecordingMeasurements,
  options: ValidateRecordingOptions = {},
): RecordingValidation {
  if (measurements.durationMs < MIN_RECORDING_MS) {
    return { accepted: false, reason: "too_short" };
  }
  if (options.allowSilent) {
    return { accepted: true };
  }
  if (measurements.peak < SILENCE_PEAK_THRESHOLD) {
    return { accepted: false, reason: "silent" };
  }
  if (measurements.voicedMs === 0) {
    return { accepted: false, reason: "silent" };
  }
  if (measurements.voicedMs < (options.minVoicedMs ?? MIN_VOICED_MS)) {
    return { accepted: false, reason: "too_short" };
  }
  return { accepted: true };
}
