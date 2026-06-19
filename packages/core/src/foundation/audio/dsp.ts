// Renderer-side audio DSP: the pure front half of the capture path (plan §6).
// getUserMedia hands us float frames; this module turns them into 16k mono
// PCM16 and finally a WAV base64 payload. getUserMedia/AudioWorklet are the
// renderer's IO; everything here is pure math with zero IO, so it lives in
// @soto/core. WAV framing is delegated to wav.ts (do not reimplement here).

import { pcm16ToWavBase64 } from "./wav.js";

const DEFAULT_TARGET_RATE = 16000;

/**
 * Average per-channel float samples into a single mono channel.
 *
 * A single channel is returned as-is. All channels must share the same length;
 * a mismatch (or an empty channel list) throws.
 */
export function downmixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) {
    throw new Error("downmixToMono requires at least one channel");
  }
  const first = channels[0]!;
  if (channels.length === 1) return first;

  const length = first.length;
  for (const ch of channels) {
    if (ch.length !== length) {
      throw new Error("downmixToMono requires all channels to have equal length");
    }
  }

  const out = new Float32Array(length);
  const channelCount = channels.length;
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (let c = 0; c < channelCount; c++) sum += channels[c]![i]!;
    out[i] = sum / channelCount;
  }
  return out;
}

/**
 * Resample a mono float signal between sample rates using linear interpolation.
 *
 * When the rates are equal the input is returned unchanged (same reference).
 * Output length is round(input.length * outputRate / inputRate). Empty input
 * yields empty output.
 */
export function resampleLinear(
  input: Float32Array,
  inputRate: number,
  outputRate: number,
): Float32Array {
  if (inputRate === outputRate) return input;
  if (input.length === 0) return new Float32Array(0);

  const ratio = outputRate / inputRate;
  const outLength = Math.round(input.length * ratio);
  if (outLength === 0) return new Float32Array(0);

  const out = new Float32Array(outLength);
  // Map each output sample back to a fractional input position and lerp between
  // the two bracketing input samples.
  const step = inputRate / outputRate;
  const lastIndex = input.length - 1;
  for (let i = 0; i < outLength; i++) {
    const pos = i * step;
    const lower = Math.floor(pos);
    if (lower >= lastIndex) {
      out[i] = input[lastIndex]!;
      continue;
    }
    const frac = pos - lower;
    const a = input[lower]!;
    const b = input[lower + 1]!;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/**
 * Quantize float samples in [-1, 1] to signed 16-bit PCM.
 *
 * Each sample is clamped to [-1, 1] then quantized asymmetrically:
 *   x < 0 ? round(x * 32768) : round(x * 32767)
 * so -1 -> -32768, 1 -> 32767, 0 -> 0. The result is clamped to the i16 range.
 * This matches pcmStats, which treats i16 -32768 as peak amplitude 1.0.
 */
export function floatToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    let x = input[i]!;
    if (x > 1) x = 1;
    else if (x < -1) x = -1;
    const scaled = x < 0 ? Math.round(x * 32768) : Math.round(x * 32767);
    out[i] = scaled < -32768 ? -32768 : scaled > 32767 ? 32767 : scaled;
  }
  return out;
}

/**
 * Root-mean-square amplitude of a float frame, in [0, 1].
 *
 * Used by the renderer capture meter to derive a per-frame level (0..1) from
 * the AudioWorklet's Float32 samples without first quantizing to PCM16. Samples
 * are clamped to [-1, 1] before squaring so an out-of-range frame can never
 * exceed 1. Empty input yields 0. Pure, zero IO.
 */
export function floatFrameRms(frame: Float32Array): number {
  if (frame.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < frame.length; i++) {
    let x = frame[i]!;
    if (x > 1) x = 1;
    else if (x < -1) x = -1;
    sumSquares += x * x;
  }
  return Math.sqrt(sumSquares / frame.length);
}

export interface EncodeCaptureOptions {
  /** Target sample rate for the produced WAV. Defaults to 16000. */
  targetRate?: number;
}

/**
 * Compose the full renderer-side capture front half: downmix to mono, resample
 * the source rate down to targetRate (default 16k), quantize to PCM16, then
 * frame as a base64-encoded mono WAV via wav.ts. Pure, zero IO.
 */
export function encodeCaptureToWavBase64(
  channels: Float32Array[],
  sourceRate: number,
  opts?: EncodeCaptureOptions,
): string {
  const targetRate = opts?.targetRate ?? DEFAULT_TARGET_RATE;
  const mono = downmixToMono(channels);
  const resampled = resampleLinear(mono, sourceRate, targetRate);
  const pcm = floatToPcm16(resampled);
  return pcm16ToWavBase64(pcm, { sampleRate: targetRate, channels: 1 });
}
