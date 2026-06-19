export interface VoicedActivityOptions {
  sampleRate?: number;
  frameMs?: number;
  noiseFloorPercentile?: number;
  voicedFactorK?: number;
  absVoicedFloor?: number;
  absNoiseFloorClamp?: number;
  onsetFrames?: number;
  hangoverFrames?: number;
}

export interface VoicedActivity {
  voicedMs: number;
  longestVoicedRunMs: number;
  noiseFloorRms: number;
}

const DEFAULT_SAMPLE_RATE = 16000;
const DEFAULT_FRAME_MS = 20;
const DEFAULT_NOISE_FLOOR_PERCENTILE = 0.15;
const DEFAULT_VOICED_FACTOR_K = 2.5;
const DEFAULT_ABS_VOICED_FLOOR = 0.004;
const DEFAULT_ABS_NOISE_FLOOR_CLAMP = 0.0005;
const DEFAULT_ONSET_FRAMES = 3;
const DEFAULT_HANGOVER_FRAMES = 4;
const I16_SCALE = 32768;
const MIN_VOICED_CREST_FACTOR = 1.2;

interface FrameStats {
  rms: number;
  peak: number;
}

function positive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonnegativeInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const clamped = Math.max(0, Math.min(1, p));
  return sorted[Math.floor((sorted.length - 1) * clamped)] ?? 0;
}

function frameStats(samples: Int16Array | readonly number[], start: number, end: number): FrameStats {
  let sumSquares = 0;
  let peak = 0;
  for (let i = start; i < end; i += 1) {
    const normalized = (samples[i] ?? 0) / I16_SCALE;
    peak = Math.max(peak, Math.abs(normalized));
    sumSquares += normalized * normalized;
  }
  return { rms: Math.sqrt(sumSquares / Math.max(1, end - start)), peak };
}

function voicedFlagsFor(
  loud: readonly boolean[],
  onsetFrames: number,
  hangoverFrames: number,
): boolean[] {
  const voiced = new Array<boolean>(loud.length).fill(false);
  let inSegment = false;
  let loudRunStart = -1;
  let loudRunLength = 0;
  let quietRunLength = 0;
  let lastLoud = -1;

  for (let i = 0; i < loud.length; i += 1) {
    if (loud[i]) {
      if (inSegment) {
        voiced[i] = true;
        quietRunLength = 0;
        lastLoud = i;
        continue;
      }

      if (loudRunLength === 0) loudRunStart = i;
      loudRunLength += 1;
      if (loudRunLength >= onsetFrames) {
        for (let j = loudRunStart; j <= i; j += 1) voiced[j] = true;
        inSegment = true;
        quietRunLength = 0;
        lastLoud = i;
      }
      continue;
    }

    loudRunLength = 0;
    loudRunStart = -1;

    if (!inSegment) continue;

    quietRunLength += 1;
    voiced[i] = true;
    if (quietRunLength > hangoverFrames) {
      for (let j = lastLoud + 1; j <= i; j += 1) voiced[j] = false;
      inSegment = false;
      quietRunLength = 0;
      lastLoud = -1;
    }
  }

  if (inSegment && quietRunLength > 0) {
    for (let j = lastLoud + 1; j < voiced.length; j += 1) voiced[j] = false;
  }

  return voiced;
}

function longestRun(flags: readonly boolean[]): number {
  let current = 0;
  let longest = 0;
  for (const flag of flags) {
    if (flag) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

function voicedLikeByAbsoluteEnergy(stats: readonly FrameStats[], absVoicedFloor: number): boolean[] {
  return stats.map(({ rms, peak }) => rms > absVoicedFloor && peak / rms >= MIN_VOICED_CREST_FACTOR);
}

export function analyzeVoicedActivity(
  pcm: Int16Array | readonly number[],
  opts: VoicedActivityOptions = {},
): VoicedActivity {
  const sampleRate = positive(opts.sampleRate, DEFAULT_SAMPLE_RATE);
  const frameMs = positive(opts.frameMs, DEFAULT_FRAME_MS);
  const frameSamples = Math.max(1, Math.round((sampleRate * frameMs) / 1000));
  const onsetFrames = Math.max(1, nonnegativeInteger(opts.onsetFrames, DEFAULT_ONSET_FRAMES));
  const hangoverFrames = nonnegativeInteger(opts.hangoverFrames, DEFAULT_HANGOVER_FRAMES);

  if (pcm.length === 0) {
    return { voicedMs: 0, longestVoicedRunMs: 0, noiseFloorRms: 0 };
  }

  const statsFrames: FrameStats[] = [];
  for (let start = 0; start < pcm.length; start += frameSamples) {
    statsFrames.push(frameStats(pcm, start, Math.min(pcm.length, start + frameSamples)));
  }
  const rmsFrames = statsFrames.map(({ rms }) => rms);

  const sortedRms = [...rmsFrames].sort((a, b) => a - b);
  const absVoicedFloor = positive(opts.absVoicedFloor, DEFAULT_ABS_VOICED_FLOOR);
  const noiseFloorRms = Math.max(
    percentile(sortedRms, opts.noiseFloorPercentile ?? DEFAULT_NOISE_FLOOR_PERCENTILE),
    positive(opts.absNoiseFloorClamp, DEFAULT_ABS_NOISE_FLOOR_CLAMP),
  );
  const voicedThreshold = Math.max(
    noiseFloorRms * positive(opts.voicedFactorK, DEFAULT_VOICED_FACTOR_K),
    absVoicedFloor,
  );
  let voiced = voicedFlagsFor(
    rmsFrames.map((rms) => rms > voicedThreshold),
    onsetFrames,
    hangoverFrames,
  );
  let voicedFrameCount = voiced.filter(Boolean).length;
  if (voicedFrameCount === 0) {
    voiced = voicedFlagsFor(
      voicedLikeByAbsoluteEnergy(statsFrames, absVoicedFloor),
      onsetFrames,
      hangoverFrames,
    );
    voicedFrameCount = voiced.filter(Boolean).length;
  }

  return {
    voicedMs: Math.round(voicedFrameCount * frameMs),
    longestVoicedRunMs: Math.round(longestRun(voiced) * frameMs),
    noiseFloorRms,
  };
}
