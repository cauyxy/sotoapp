import { describe, expect, it } from "vitest";
import { rmsAndPeak } from "./pcmStats.js";

describe("rmsAndPeak", () => {
  it("returns zero rms and peak for empty input", () => {
    expect(rmsAndPeak(new Int16Array([]))).toEqual({ rms: 0, peak: 0 });
  });

  it("returns zero for all-zero samples", () => {
    expect(rmsAndPeak(new Int16Array(1024))).toEqual({ rms: 0, peak: 0 });
  });

  it("a single positive full-scale sample yields peak 32767/32768", () => {
    const { peak } = rmsAndPeak(new Int16Array([32767]));
    expect(peak).toBeCloseTo(32767 / 32768, 6);
  });

  it("uses abs() so the negative full-scale sample (-32768) yields peak 1.0", () => {
    const { peak } = rmsAndPeak(new Int16Array([-32768]));
    expect(peak).toBeCloseTo(1.0, 6);
  });

  it("constant amplitude gives rms == peak == amplitude", () => {
    const { rms, peak } = rmsAndPeak(new Int16Array(1000).fill(16384));
    expect(rms).toBeCloseTo(0.5, 4);
    expect(peak).toBeCloseTo(0.5, 4);
  });
});
