import { describe, expect, it } from "vitest";

import { encodeCaptureToWavBase64 } from "@soto/core";

import { FrameAccumulator, decodeWavPcm } from "./capture-buffer.js";

describe("FrameAccumulator", () => {
  it("starts empty", () => {
    const acc = new FrameAccumulator();
    expect(acc.channelLanes).toBe(0);
    expect(acc.sampleCount).toBe(0);
    expect(acc.drain()).toEqual([]);
  });

  it("ignores empty frames", () => {
    const acc = new FrameAccumulator();
    acc.push([]);
    expect(acc.channelLanes).toBe(0);
    expect(acc.sampleCount).toBe(0);
  });

  it("locks the channel count to the first frame and concatenates per channel", () => {
    const acc = new FrameAccumulator();
    acc.push([new Float32Array([0.1, 0.2]), new Float32Array([0.3, 0.4])]);
    acc.push([new Float32Array([0.5]), new Float32Array([0.6])]);

    expect(acc.channelLanes).toBe(2);
    expect(acc.sampleCount).toBe(3);

    const [left, right] = acc.drain();
    expect(Array.from(left!)).toEqual([
      0.1, 0.2, 0.5,
    ].map((v) => Math.fround(v)));
    expect(Array.from(right!)).toEqual([
      0.3, 0.4, 0.6,
    ].map((v) => Math.fround(v)));
  });

  it("handles variable per-quantum frame lengths", () => {
    const acc = new FrameAccumulator();
    acc.push([new Float32Array([1, 2, 3])]);
    acc.push([new Float32Array([4])]);
    acc.push([new Float32Array([5, 6])]);

    expect(acc.sampleCount).toBe(6);
    expect(Array.from(acc.drain()[0]!)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("throws if the channel count changes mid-stream", () => {
    const acc = new FrameAccumulator();
    acc.push([new Float32Array([0.1])]);
    expect(() =>
      acc.push([new Float32Array([0.1]), new Float32Array([0.2])]),
    ).toThrow(/channel count changed 1 -> 2/);
  });

  it("produces a contiguous buffer sized to the accumulated total", () => {
    const acc = new FrameAccumulator();
    acc.push([new Float32Array(128)]);
    acc.push([new Float32Array(128)]);
    const [mono] = acc.drain();
    expect(mono!.length).toBe(256);
  });
});

describe("decodeWavPcm", () => {
  it("round-trips PCM through @soto/core's WAV encoder", () => {
    // Constant 16 kHz mono frame at 0.5 → encodeCaptureToWavBase64 is identity
    // on rate, so PCM16 ≈ round(0.5 * 32767) = 16384.
    const frame = new Float32Array(32).fill(0.5);
    const b64 = encodeCaptureToWavBase64([frame], 16000);
    const { pcm, sampleCount } = decodeWavPcm(b64);

    expect(sampleCount).toBe(32);
    expect(pcm.length).toBe(32);
    for (const sample of pcm) expect(sample).toBe(16384);
  });

  it("reports a zero sample count for a header-only WAV", () => {
    const b64 = encodeCaptureToWavBase64([new Float32Array(0)], 16000);
    const { pcm, sampleCount } = decodeWavPcm(b64);
    expect(sampleCount).toBe(0);
    expect(pcm.length).toBe(0);
  });

  it("decodes signed samples correctly (little-endian)", () => {
    const frame = new Float32Array([-1, 1, 0]);
    const b64 = encodeCaptureToWavBase64([frame], 16000);
    const { pcm } = decodeWavPcm(b64);
    expect(Array.from(pcm)).toEqual([-32768, 32767, 0]);
  });
});
