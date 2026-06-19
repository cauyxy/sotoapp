import { describe, expect, it } from "vitest";

import {
  ARIA_LABELS,
  EXIT_SINK_MS,
  SUCCESS_BAND_SPRINT_MS,
  SUCCESS_CHECK_DELAY_MS,
  SUCCESS_CHECK_POP_MS,
  WAVE_DIFFUSION_DELAY_MS,
  WAVE_JITTER,
  STATE_WIDTHS,
  WAVE_PROFILE,
  barFreqHz,
  barPhaseRad,
  barStateFor,
  computeWaveScale,
  exitPlanFor,
  initWaveBarsState,
  modeIdentityFor,
  quantizeWaveScale,
  shouldShowIntro,
  stepWaveBars,
  thinkingProgressPct,
  waveBarStaggerMs,
  widthFor,
  type WaveBarsState,
} from "./capsuleMeterModel";

const cleanResult = {
  history_id: "h",
  raw_text: "hi",
  final_text: "hi",
  status: "completed",
  injection_outcome: { kind: "paste_sent" },
} as const;

describe("barStateFor", () => {
  it("maps listening/thinking/failed onto their bar states", () => {
    expect(barStateFor("listening")).toBe("listening");
    expect(barStateFor("thinking")).toBe("thinking");
    expect(barStateFor("failed")).toBe("error");
  });

  it("folds the inserting phase into the thinking face (no distinct insert glyph)", () => {
    expect(barStateFor("inserting")).toBe("thinking");
  });

  it("collapses idle/completed/cancelled onto idle", () => {
    expect(barStateFor("idle")).toBe("idle");
    expect(barStateFor("completed")).toBe("idle");
    expect(barStateFor("cancelled")).toBe("idle");
  });
});

describe("barStateFor with terminal differentiation", () => {
  it("clean success → success face; width holds at the listening width", () => {
    expect(barStateFor("completed", cleanResult)).toBe("success");
    expect(STATE_WIDTHS.success).toBe(108);
  });

  it("completed with an empty reason stays idle (panel does the talking)", () => {
    expect(
      barStateFor("completed", { ...cleanResult, status: "empty", empty_reason: "silent" }),
    ).toBe("idle");
  });

  it("cancelled keeps its current face (exit choreography owns the goodbye)", () => {
    expect(barStateFor("cancelled", null)).toBe("idle");
  });
});

describe("modeIdentityFor / widthFor", () => {
  it("classifies the canonical modes", () => {
    expect(modeIdentityFor("default", "Default").kind).toBe("default");
    expect(modeIdentityFor("translate", "Translate")).toEqual({
      kind: "translate",
      modeId: "translate",
      label: "Translate",
    });
    expect(modeIdentityFor("my-mode", "Notes").kind).toBe("custom");
  });

  it("non-default modes widen for the glyph, wider still during the intro", () => {
    const t = modeIdentityFor("translate", "Translate");
    expect(widthFor("listening", t, false)).toBe(124);
    expect(widthFor("listening", t, true)).toBe(178);
    expect(widthFor("success", t, false)).toBe(124);
    const d = modeIdentityFor("default", "Default");
    expect(widthFor("listening", d, false)).toBe(108);
    expect(widthFor("idle", d, false)).toBe(60);
  });
});

describe("intro suppression", () => {
  it("shows the intro for a non-default mode, suppresses repeats within 30s", () => {
    const t = modeIdentityFor("translate", "Translate");
    expect(shouldShowIntro(t, null, 1000)).toBe(true);
    expect(shouldShowIntro(t, { modeId: "translate", at: 1000 }, 20000)).toBe(false);
    expect(shouldShowIntro(t, { modeId: "translate", at: 1000 }, 40000)).toBe(true);
    expect(shouldShowIntro(modeIdentityFor("default", null), null, 0)).toBe(false);
  });
});

describe("computeWaveScale", () => {
  it("pins to the quiet floor for every non-listening state", () => {
    expect(computeWaveScale("idle", 1, 65535)).toBe(0.26);
    expect(computeWaveScale("thinking", 1, 65535)).toBe(0.26);
    expect(computeWaveScale("error", 1, 65535)).toBe(0.26);
  });

  it("scales between the quiet floor and 1.0 with the local level while listening", () => {
    expect(computeWaveScale("listening", 0, 0)).toBe(0.26);
    expect(computeWaveScale("listening", 0.5, 0)).toBeCloseTo(1, 10);
    expect(computeWaveScale("listening", 1, 0)).toBeCloseTo(1, 10);
  });

  it("expands typical speech RMS into visibly distinct quiet/medium/high bands", () => {
    expect(computeWaveScale("listening", 0.005, 0)).toBe(0.26);
    expect(computeWaveScale("listening", 0.02, 0)).toBeGreaterThan(0.42);
    expect(computeWaveScale("listening", 0.02, 0)).toBeLessThan(0.5);
    expect(computeWaveScale("listening", 0.08, 0)).toBeGreaterThan(0.78);
    expect(computeWaveScale("listening", 0.16, 0)).toBeCloseTo(1, 10);
  });

  it("retuned curve table (2026-06-12 aliveness pass)", () => {
    const table: ReadonlyArray<[number, number]> = [
      [0.005, 0.26],
      [0.02, 0.4626],
      [0.05, 0.679],
      [0.08, 0.8327],
      [0.12, 1],
      [0.16, 1],
    ];
    for (const [raw, expected] of table) {
      expect(computeWaveScale("listening", raw, 0)).toBeCloseTo(expected, 2);
    }
  });

  it("falls back to the normalized wire rms when it exceeds the local level", () => {
    // Wire rms is in the 0..65535 range; normalizeLevel(32768) ≈ 0.5.
    expect(computeWaveScale("listening", 0, 32768)).toBeCloseTo(1, 10);
    // The larger of (localLevel, normalized wire rms) wins.
    expect(computeWaveScale("listening", 0.08, 32768)).toBeCloseTo(1, 10);
  });

  it("clamps an out-of-range local level into the wave scale range", () => {
    expect(computeWaveScale("listening", -1, 0)).toBe(0.26);
    expect(computeWaveScale("listening", 5, 0)).toBeCloseTo(1, 10);
  });
});

describe("quantizeWaveScale", () => {
  it("snaps to the 4-step ladder", () => {
    expect(quantizeWaveScale(0.3)).toBe(0.3);
    expect(quantizeWaveScale(0.41)).toBe(0.3);
    expect(quantizeWaveScale(0.44)).toBe(0.55);
    expect(quantizeWaveScale(0.7)).toBe(0.8);
    expect(quantizeWaveScale(1)).toBe(1);
  });
});

describe("wave attack stagger (tuned 2026-06-12 for attack speed)", () => {
  it("ripples from the center outward with a tight 28ms step", () => {
    expect(WAVE_DIFFUSION_DELAY_MS).toBe(28);
    expect(WAVE_PROFILE.map((_, i) => waveBarStaggerMs(i))).toEqual([
      168, 140, 112, 84, 56, 28, 0, 0, 28, 56, 84, 112, 140, 168,
    ]);
  });
});

describe("stepWaveBars (asymmetric envelope + micro-jitter)", () => {
  const FLOOR = 0.26;
  const FRAME = 16.7;

  function run(
    frames: number,
    target: number,
    voiced: number,
    startMs = 0,
  ): ReturnType<typeof stepWaveBars> {
    let state = initWaveBarsState();
    let out: ReturnType<typeof stepWaveBars> = { state, shown: [...state.eased] };
    for (let f = 1; f <= frames; f++) {
      out = stepWaveBars(state, target, voiced, FRAME, startMs + f * FRAME);
      state = out.state;
    }
    return out;
  }

  it("attack: a center bar reaches ≥90% of a full step within ~70ms", () => {
    const { state } = run(4, 1, 1); // 4 frames ≈ 67ms; center bars have 0 stagger
    const centerProgress = ((state.eased[6] ?? 0) - FLOOR) / (1 - FLOOR);
    expect(centerProgress).toBeGreaterThanOrEqual(0.9);
  });

  it("release is strictly slower than attack for the same step", () => {
    const riseFrame = stepWaveBars(initWaveBarsState(), 1, 1, FRAME, FRAME);
    const rise = (riseFrame.state.eased[6] ?? 0) - FLOOR;
    const full: WaveBarsState = {
      eased: new Array(14).fill(1),
      riseOriginMs: new Array(14).fill(-1),
    };
    const fallFrame = stepWaveBars(full, FLOOR, 0, FRAME, FRAME);
    const fall = 1 - (fallFrame.state.eased[6] ?? 1);
    expect(rise).toBeGreaterThan(fall * 2);
  });

  it("attack staggers center-out; falls drop together with no stagger", () => {
    // Rising edge: after ~100ms the outermost bars (168ms stagger) have not
    // moved while the center has risen well clear of the floor.
    const at100 = run(6, 1, 1); // 6 × 16.7 ≈ 100ms
    expect(at100.state.eased[0]).toBeCloseTo(FLOOR, 10);
    expect(at100.state.eased[6] ?? 0).toBeGreaterThan(0.7);
    // After ~400ms everyone has arrived.
    const at400 = run(24, 1, 1);
    expect(at400.state.eased[0] ?? 0).toBeGreaterThan(0.85);
    // Falling: from full height all bars drop in the SAME frame.
    const full: WaveBarsState = {
      eased: new Array(14).fill(1),
      riseOriginMs: new Array(14).fill(-1),
    };
    const fell = stepWaveBars(full, FLOOR, 0, FRAME, FRAME);
    const drops = fell.state.eased.map((v) => 1 - v);
    for (const d of drops) expect(d).toBeCloseTo(drops[0] ?? 0, 10);
  });

  it("silence is dead still: floor heights, identical across time", () => {
    const a = run(60, FLOOR, 0, 0);
    const b = run(60, FLOOR, 0, 100000);
    for (let i = 0; i < 14; i++) {
      const expected = Math.min(
        1,
        Math.max(FLOOR, FLOOR * (WAVE_JITTER[i % WAVE_JITTER.length] ?? 1)),
      );
      expect(a.shown[i]).toBeCloseTo(expected, 6);
      expect(a.shown[i]).toBeCloseTo(b.shown[i] ?? 0, 10);
    }
  });

  it("a held vowel breathes: the same bar differs across time, within bounds", () => {
    const settled = run(60, 0.9, 1);
    const later = stepWaveBars(settled.state, 0.9, 1, FRAME, 60 * FRAME + 137);
    expect(later.shown[6]).not.toBeCloseTo(settled.shown[6] ?? 0, 4);
    for (const v of [...settled.shown, ...later.shown]) {
      expect(v).toBeGreaterThanOrEqual(FLOOR);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic and per-bar decorrelated", () => {
    const a = stepWaveBars(initWaveBarsState(), 0.8, 1, FRAME, 500);
    const b = stepWaveBars(initWaveBarsState(), 0.8, 1, FRAME, 500);
    expect(a).toEqual(b);
    const freqs = new Set(WAVE_PROFILE.map((_, i) => barFreqHz(i)));
    expect(freqs.size).toBeGreaterThan(3);
    expect(barPhaseRad(3)).not.toBeCloseTo(barPhaseRad(4), 6);
  });
});

describe("thinkingProgressPct (Soto fast-then-slow curve)", () => {
  it("interpolates the keyframe table and clamps at the 99% asymptote", () => {
    expect(thinkingProgressPct(0)).toBe(0);
    expect(thinkingProgressPct(400)).toBeCloseTo(35, 6); // halfway to [0.8s, 70]
    expect(thinkingProgressPct(800)).toBeCloseTo(70, 6);
    expect(thinkingProgressPct(1400)).toBeCloseTo(84, 6); // the main floor lands here
    expect(thinkingProgressPct(2500)).toBeCloseTo(91, 6);
    expect(thinkingProgressPct(7000)).toBeCloseTo(97.5, 6);
    expect(thinkingProgressPct(14000)).toBeCloseTo(99, 6);
    expect(thinkingProgressPct(60000)).toBe(99); // never auto-completes
    expect(thinkingProgressPct(-50)).toBe(0);
  });
});

describe("exitPlanFor", () => {
  it("sinks out over the final 180ms by default", () => {
    expect(exitPlanFor("success", 700)).toEqual({
      variant: "sink",
      startMs: 520,
      durationMs: 180,
    });
  });

  it("cancel retracts fast (120ms)", () => {
    expect(exitPlanFor("cancel", 200)).toEqual({
      variant: "fast",
      startMs: 80,
      durationMs: 120,
    });
  });

  it("clamps when the linger is shorter than the exit", () => {
    expect(exitPlanFor("success", 100)).toEqual({
      variant: "sink",
      startMs: 0,
      durationMs: 100,
    });
  });

  it("sinks notice/error/default exits instead of deriving from renderer phase", () => {
    expect(exitPlanFor("notice", 450).variant).toBe("sink");
    expect(exitPlanFor("error", 450).variant).toBe("sink");
    expect(exitPlanFor("default", 450).variant).toBe("sink");
  });
});

describe("success/insertion timing constants", () => {
  it("keeps the success check after the 100% band sprint and before exit", () => {
    expect(SUCCESS_BAND_SPRINT_MS).toBe(100);
    expect(SUCCESS_CHECK_DELAY_MS).toBe(120);
    expect(SUCCESS_CHECK_POP_MS).toBe(180);
    const checkDoneAt = SUCCESS_CHECK_DELAY_MS + SUCCESS_CHECK_POP_MS;
    expect(SUCCESS_CHECK_DELAY_MS).toBeGreaterThanOrEqual(SUCCESS_BAND_SPRINT_MS);
    expect(exitPlanFor("success", 700).startMs).toBeGreaterThan(checkDoneAt);
    expect(exitPlanFor("success", 700).durationMs).toBe(EXIT_SINK_MS);
  });
});

describe("verbatim presentation constants (Tenet 7 — muscle memory)", () => {
  it("keeps the 14-bar wave profile byte-for-byte", () => {
    expect(WAVE_PROFILE).toEqual([
      0.48, 0.74, 1, 0.62, 0.36, 0.86, 0.56, 0.95, 0.66, 0.5, 0.78, 0.4, 0.68,
      0.52,
    ]);
  });

  it("keeps the per-state pill widths", () => {
    expect(STATE_WIDTHS).toEqual({
      idle: 60,
      listening: 108,
      thinking: 108,
      error: 116,
      success: 108,
    });
  });

  it("keeps the per-state aria labels", () => {
    expect(ARIA_LABELS).toEqual({
      idle: "Voice input idle",
      listening: "Listening",
      thinking: "Polishing",
      error: "Not heard",
      success: "Inserted",
    });
  });
});
