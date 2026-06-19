import { describe, expect, it } from "vitest";
import {
  downmixToMono,
  encodeCaptureToWavBase64,
  floatFrameRms,
  floatToPcm16,
  resampleLinear,
} from "./dsp.js";

const u32le = (bytes: Uint8Array, off: number): number =>
  (bytes[off]! |
    (bytes[off + 1]! << 8) |
    (bytes[off + 2]! << 16) |
    (bytes[off + 3]! << 24)) >>>
  0;

const ascii = (bytes: Uint8Array, off: number, len: number): string =>
  String.fromCharCode(...bytes.subarray(off, off + len));

describe("downmixToMono", () => {
  it("returns the single channel as-is (same reference)", () => {
    const ch = new Float32Array([0.1, 0.2, 0.3]);
    const out = downmixToMono([ch]);
    expect(out).toBe(ch);
  });

  it("averages across two channels per sample", () => {
    const left = new Float32Array([0.0, 1.0, -0.5]);
    const right = new Float32Array([1.0, -1.0, 0.5]);
    const out = downmixToMono([left, right]);
    expect(Array.from(out)).toEqual([0.5, 0.0, 0.0]);
  });

  it("averages across more than two channels", () => {
    const a = new Float32Array([0.3]);
    const b = new Float32Array([0.6]);
    const c = new Float32Array([0.9]);
    const out = downmixToMono([a, b, c]);
    expect(out[0]).toBeCloseTo(0.6, 6);
  });

  it("throws when no channels are provided", () => {
    expect(() => downmixToMono([])).toThrow();
  });

  it("throws when channel lengths differ", () => {
    const a = new Float32Array([0.1, 0.2]);
    const b = new Float32Array([0.1]);
    expect(() => downmixToMono([a, b])).toThrow();
  });
});

describe("resampleLinear", () => {
  it("returns input unchanged when rates are equal", () => {
    const input = new Float32Array([0.1, 0.2, 0.3]);
    const out = resampleLinear(input, 16000, 16000);
    expect(out).toBe(input);
  });

  it("handles empty input", () => {
    const out = resampleLinear(new Float32Array(0), 48000, 16000);
    expect(out.length).toBe(0);
  });

  it("halves the length when downsampling 2x (round)", () => {
    const input = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7]); // len 8
    const out = resampleLinear(input, 48000, 24000); // ratio 0.5
    expect(out.length).toBe(4); // round(8 * 0.5)
  });

  it("doubles the length when upsampling 2x (round)", () => {
    const input = new Float32Array([0, 1, 2, 3]); // len 4
    const out = resampleLinear(input, 24000, 48000); // ratio 2
    expect(out.length).toBe(8); // round(4 * 2)
  });

  it("linearly interpolates a ramp at the midpoint", () => {
    // 2-sample ramp [0, 2] upsampled 1->2 (ratio 2) -> length 4, step 0.5.
    // Output positions: 0, 0.5, 1.0, 1.5. Pos 0.5 lands exactly between the two
    // input samples, so out[1] is the interpolated midpoint = 1.
    const ramp = new Float32Array([0, 2]);
    const up = resampleLinear(ramp, 1, 2);
    expect(up.length).toBe(4);
    expect(up[0]!).toBeCloseTo(0, 6);
    expect(up[1]!).toBeCloseTo(1, 6); // midpoint interpolation between 0 and 2
    expect(up[2]!).toBeCloseTo(2, 6); // last input sample
    expect(up[3]!).toBeCloseTo(2, 6); // beyond last index clamps to last sample
  });
});

describe("floatToPcm16", () => {
  it("maps boundary and mid values per the asymmetric convention", () => {
    const out = floatToPcm16(new Float32Array([-1, 1, 0, 0.5]));
    expect(out[0]).toBe(-32768); // -1 * 32768
    expect(out[1]).toBe(32767); // 1 * 32767
    expect(out[2]).toBe(0);
    expect(out[3]).toBe(Math.round(0.5 * 32767)); // 16384 (16383.5 -> 16384)
  });

  it("clamps values beyond [-1, 1]", () => {
    const out = floatToPcm16(new Float32Array([-2, 2, -1.5, 1.5]));
    expect(out[0]).toBe(-32768);
    expect(out[1]).toBe(32767);
    expect(out[2]).toBe(-32768);
    expect(out[3]).toBe(32767);
  });

  it("returns an Int16Array of equal length", () => {
    const out = floatToPcm16(new Float32Array([0.1, -0.1, 0.25]));
    expect(out).toBeInstanceOf(Int16Array);
    expect(out.length).toBe(3);
  });
});

describe("encodeCaptureToWavBase64", () => {
  it("produces a decodable mono 16k WAV from a 48k buffer", () => {
    // 48 input samples -> round(48 * 16000/48000) = 16 output samples.
    const src = new Float32Array(48);
    for (let i = 0; i < src.length; i++) src[i] = Math.sin((i / 48) * Math.PI * 2) * 0.5;

    const b64 = encodeCaptureToWavBase64([src], 48000);
    const wav = new Uint8Array(Buffer.from(b64, "base64"));

    const expectedSamples = Math.round(src.length * (16000 / 48000)); // 16
    expect(ascii(wav, 0, 4)).toBe("RIFF");
    expect(ascii(wav, 8, 4)).toBe("WAVE");
    expect(u32le(wav, 24)).toBe(16000); // sampleRate = targetRate
    expect(wav.length).toBe(44 + expectedSamples * 2);
    expect(u32le(wav, 40)).toBe(expectedSamples * 2); // dataLen
  });

  it("downmixes stereo before resampling", () => {
    const left = new Float32Array(24).fill(1.0);
    const right = new Float32Array(24).fill(-1.0);
    const b64 = encodeCaptureToWavBase64([left, right], 48000);
    const wav = new Uint8Array(Buffer.from(b64, "base64"));
    // averaged to 0.0, so all PCM samples are 0.
    for (let off = 44; off < wav.length; off++) expect(wav[off]).toBe(0);
  });

  it("honors a custom targetRate", () => {
    const src = new Float32Array(48).fill(0.25);
    const b64 = encodeCaptureToWavBase64([src], 48000, { targetRate: 8000 });
    const wav = new Uint8Array(Buffer.from(b64, "base64"));
    expect(u32le(wav, 24)).toBe(8000);
    const expectedSamples = Math.round(src.length * (8000 / 48000)); // 8
    expect(wav.length).toBe(44 + expectedSamples * 2);
  });
});

describe("floatFrameRms", () => {
  it("returns 0 for an empty frame", () => {
    expect(floatFrameRms(new Float32Array(0))).toBe(0);
  });

  it("returns 0 for digital silence", () => {
    expect(floatFrameRms(new Float32Array(64))).toBe(0);
  });

  it("returns 1 for a full-scale square frame", () => {
    const frame = new Float32Array(8);
    for (let i = 0; i < frame.length; i++) frame[i] = i % 2 === 0 ? 1 : -1;
    expect(floatFrameRms(frame)).toBeCloseTo(1, 6);
  });

  it("computes RMS of a constant frame as its magnitude", () => {
    const frame = new Float32Array(16).fill(0.5);
    expect(floatFrameRms(frame)).toBeCloseTo(0.5, 6);
  });

  it("computes sqrt(mean of squares)", () => {
    // [0.6, 0.8] -> sqrt((0.36 + 0.64) / 2) = sqrt(0.5)
    const frame = new Float32Array([0.6, 0.8]);
    expect(floatFrameRms(frame)).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it("clamps out-of-range samples so RMS never exceeds 1", () => {
    const frame = new Float32Array([2, -3, 1.5]);
    expect(floatFrameRms(frame)).toBeCloseTo(1, 6);
  });
});
