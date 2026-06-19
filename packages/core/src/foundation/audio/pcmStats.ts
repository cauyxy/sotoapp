// Pure-TS port of soto_audio::pcm_stats::rms_and_peak. PCM i16 LE sample
// statistics: peak amplitude (max |sample| / 32768) and RMS, each in [0, 1].
// Empty input returns zeros.

export interface PcmStats {
  rms: number;
  peak: number;
}

const FULL_SCALE = 32768;

export function rmsAndPeak(samples: Int16Array | readonly number[]): PcmStats {
  if (samples.length === 0) return { rms: 0, peak: 0 };

  let peak = 0;
  let sumSquares = 0;
  for (const sample of samples) {
    const normalized = sample / FULL_SCALE;
    const magnitude = Math.abs(sample) / FULL_SCALE;
    if (magnitude > peak) peak = magnitude;
    sumSquares += normalized * normalized;
  }
  const rms = Math.sqrt(sumSquares / samples.length);
  return { rms, peak };
}
