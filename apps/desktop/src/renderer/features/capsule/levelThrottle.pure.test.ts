import { describe, expect, it } from "vitest";
import { createLevelThrottle } from "./levelThrottle.pure";

describe("createLevelThrottle (peak-hold ~30Hz gate)", () => {
  it("emits at the gate cadence: first sample passes, then one per interval", () => {
    const t = createLevelThrottle(33);
    expect(t.sample(0.05, 1000)).toBe(0.05);
    expect(t.sample(0.05, 1002.67)).toBeNull();
    expect(t.sample(0.05, 1005.33)).toBeNull();
    expect(t.sample(0.05, 1032.9)).toBeNull();
    expect(t.sample(0.05, 1033.0)).toBe(0.05);
  });

  it("holds the window PEAK: a transient between emits is never discarded", () => {
    const t = createLevelThrottle(33);
    expect(t.sample(0.02, 1000)).toBe(0.02); // gate opens
    expect(t.sample(0.14, 1002.67)).toBeNull(); // syllable onset in the gap
    expect(t.sample(0.03, 1005.33)).toBeNull();
    // Next gate opening reports the held 0.14 peak, NOT the latest 0.02.
    expect(t.sample(0.02, 1033.4)).toBe(0.14);
  });

  it("resets the held peak after each emit (windows do not bleed)", () => {
    const t = createLevelThrottle(33);
    t.sample(0.14, 1000);
    expect(t.sample(0.02, 1033.4)).toBe(0.02);
  });

  it("reset() clears both the held peak and the gate", () => {
    const t = createLevelThrottle(33);
    t.sample(0.14, 1000);
    t.sample(0.2, 1001); // held in the window
    t.reset();
    // Gate reopened (lastEmit=0) and the held 0.2 is gone.
    expect(t.sample(0.01, 1002)).toBe(0.01);
  });
});
