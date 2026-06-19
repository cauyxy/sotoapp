import { describe, expect, it } from "vitest";
import { analyzeVoicedActivity } from "./voicedActivity.js";

const SAMPLE_RATE = 16000;
const FRAME_MS = 20;

function samplesForMs(ms: number): number {
  return Math.round((ms / 1000) * SAMPLE_RATE);
}

function silence(ms: number): Int16Array {
  return new Int16Array(samplesForMs(ms));
}

function sine(ms: number, amplitude: number, frequencyHz = 220): Int16Array {
  const out = new Int16Array(samplesForMs(ms));
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Math.round(Math.sin((2 * Math.PI * frequencyHz * i) / SAMPLE_RATE) * amplitude * 32767);
  }
  return out;
}

function steady(ms: number, amplitude: number): Int16Array {
  return new Int16Array(samplesForMs(ms)).fill(Math.round(amplitude * 32767));
}

function seededNoise(ms: number, amplitude: number): Int16Array {
  let state = 0x12345678;
  const out = new Int16Array(samplesForMs(ms));
  for (let i = 0; i < out.length; i += 1) {
    state = (1664525 * state + 1013904223) >>> 0;
    const normalized = state / 0xffffffff;
    out[i] = Math.round((normalized * 2 - 1) * amplitude * 32767);
  }
  return out;
}

function concat(...chunks: readonly Int16Array[]): Int16Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Int16Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function mix(a: Int16Array, b: Int16Array): Int16Array {
  expect(a.length).toBe(b.length);
  const out = new Int16Array(a.length);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Math.max(-32768, Math.min(32767, a[i]! + b[i]!));
  }
  return out;
}

describe("analyzeVoicedActivity", () => {
  it("returns zero voiced duration for pure silence", () => {
    expect(analyzeVoicedActivity(silence(1000))).toMatchObject({
      voicedMs: 0,
      longestVoicedRunMs: 0,
    });
  });

  it("does not count a two-frame transient as speech", () => {
    const pcm = concat(silence(200), sine(2 * FRAME_MS, 0.8), silence(200));

    expect(analyzeVoicedActivity(pcm).voicedMs).toBe(0);
  });

  it("counts a one-second voiced region", () => {
    const pcm = concat(silence(100), sine(1000, 0.08), silence(100));

    expect(analyzeVoicedActivity(pcm).voicedMs).toBeCloseTo(1000, -2);
  });

  it("counts speech that fills the whole recording", () => {
    expect(analyzeVoicedActivity(sine(1000, 0.08)).voicedMs).toBeCloseTo(1000, -2);
  });

  it("detects quiet speech over a low noise floor", () => {
    const pcm = concat(silence(100), mix(sine(500, 0.009), seededNoise(500, 0.001)), silence(100));

    expect(analyzeVoicedActivity(pcm).voicedMs).toBeGreaterThanOrEqual(400);
  });

  it("does not count steady high-energy noise as speech", () => {
    const pcm = steady(1000, 0.06);

    expect(analyzeVoicedActivity(pcm).voicedMs).toBe(0);
  });

  it("bridges a short gap inside one utterance", () => {
    const pcm = concat(silence(100), sine(470, 0.08), silence(60), sine(470, 0.08), silence(100));
    const activity = analyzeVoicedActivity(pcm);

    expect(activity.voicedMs).toBeCloseTo(1000, -2);
    expect(activity.longestVoicedRunMs).toBeCloseTo(1000, -2);
  });

  it("detects speech at roughly 10 dB SNR", () => {
    const noise = seededNoise(700, 0.004);
    const speech = concat(silence(100), sine(500, 0.018), silence(100));

    expect(analyzeVoicedActivity(mix(speech, noise)).voicedMs).toBeGreaterThanOrEqual(400);
  });

  it("ignores tiny dither above digital zero", () => {
    const pcm = seededNoise(1000, 0.0001);

    expect(analyzeVoicedActivity(pcm).voicedMs).toBe(0);
  });
});
