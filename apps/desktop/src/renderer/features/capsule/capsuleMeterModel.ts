// Pure presentation model for the recording capsule's level meter (audit
// §3.2 step 13 / `capsule-capture-driver-vs-view`). These are the framework-free
// shapes the <CapsuleMeter> view renders off: the four visual states, their pill
// widths / aria labels, the equalizer's spatial wave profile, and the small bits
// of math that map a capsule phase + live level onto what the view draws.
//
// Extracted out of capsule.tsx so the presentation is deterministic and unit
// tested without a DOM (vitest runs in the node environment). The capture driver
// (useCaptureDriver) and the view (CapsuleMeter) both consume this module.

import { normalizeLevel, type CapsuleState, type CompleteResult } from "@soto/core";

export type CapsuleExitIntent =
  | "success"
  | "cancel"
  | "error"
  | "notice"
  | "default";

/** How the pill leaves: the default sink-fade, or the fast cancel retraction. */
export interface ExitPlan {
  variant: "sink" | "fast";
  /** ms after the will-hide push at which the exit animation starts. */
  startMs: number;
  durationMs: number;
}

export const EXIT_SINK_MS = 180;
export const EXIT_FAST_MS = 120;
export const SUCCESS_BAND_SPRINT_MS = 100;
export const SUCCESS_CHECK_DELAY_MS = 120;
export const SUCCESS_CHECK_POP_MS = 180;

export type BarState =
  | "idle"
  | "listening"
  | "thinking"
  | "error"
  | "success";

// Per-state pill width (px) — the capsule animates between these (verbatim from
// the old VoiceCapsule).
export const STATE_WIDTHS: Record<BarState, number> = {
  idle: 60,
  listening: 108,
  thinking: 108,
  error: 116,
  success: 108,
};

export const ARIA_LABELS: Record<BarState, string> = {
  idle: "Voice input idle",
  listening: "Listening",
  thinking: "Polishing",
  error: "Not heard",
  success: "Inserted",
};

// Friendly, fixed error label (the old capsule never surfaced raw error text).
export const ERROR_LABEL = "Not heard";

// Spatial wave shape (14 bars) — verbatim from the old VoiceCapsule so the
// equalizer keeps its organic profile instead of a flat block.
export const WAVE_PROFILE = [
  0.48, 0.74, 1, 0.62, 0.36, 0.86, 0.56, 0.95, 0.66, 0.5, 0.78, 0.4, 0.68, 0.52,
];

// Tuned 2026-06-12 (aliveness pass): 80ms put the outermost bars 480ms behind
// the signal — half a second of lag reads as deaf, not as a ripple. 28ms keeps
// the center-out diffusion (max 168ms at bars 0/13) while the wave still
// tracks speech.
export const WAVE_DIFFUSION_DELAY_MS = 28;

// Aliveness tuning (2026-06-12): full visual height now lands at RMS 0.12
// (was 0.16 — already a medium-loud voice), the noise gate opens a hair
// earlier, the response curve lifts the low-mid band harder, and the resting
// floor drops so speech has more visible travel.
export const WAVE_MIN_SCALE = 0.26;
const WAVE_NOISE_FLOOR = 0.008;
const WAVE_FULL_VOICE_LEVEL = 0.12;
const WAVE_RESPONSE_CURVE = 0.58;
/** Discrete VU ladder for prefers-reduced-motion (WCAG 2.3.3): at most ~2
 * visual changes per second, zero continuous motion. */
const WAVE_SCALE_STEPS = [0.3, 0.55, 0.8, 1] as const;
export const REDUCED_MOTION_METER_INTERVAL_MS = 500;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function waveLevelFromRaw(rawLevel: number): number {
  const level = clamp01(rawLevel);
  if (level <= WAVE_NOISE_FLOOR) return 0;
  const voiced = (level - WAVE_NOISE_FLOOR) / (WAVE_FULL_VOICE_LEVEL - WAVE_NOISE_FLOOR);
  return Math.pow(clamp01(voiced), WAVE_RESPONSE_CURVE);
}

/**
 * Per-bar ATTACK stagger (center-out, 28ms steps). Formerly a CSS
 * transition-delay; now consumed by stepWaveBars as a rise-only hold so the
 * center-out ripple exists on the way UP while falls snap together (a
 * symmetric CSS delay smeared the decay and read as lag).
 */
export function waveBarStaggerMs(
  index: number,
  barCount = WAVE_PROFILE.length,
): number {
  if (barCount <= 1) return 0;
  const boundedIndex = Math.max(0, Math.min(index, barCount - 1));
  const midpoint = (barCount - 1) / 2;
  const centerOffset = Math.max(
    0,
    Math.ceil(Math.abs(boundedIndex - midpoint) - 0.5),
  );
  return centerOffset * WAVE_DIFFUSION_DELAY_MS;
}

// --- Live-wave envelope + micro-jitter (2026-06-12 aliveness escalation) ---
//
// The bars are animated entirely in JS (the CSS transition is gone): an
// asymmetric exponential envelope — fast attack so syllables snap, slower
// release so falls stay smooth — plus two layers of organic texture: a static
// per-bar multiplier (uneven syllable heights instead of a monolith) and a
// small voiced-gated temporal wobble (a held vowel visibly breathes; silence
// is dead still, so the resting state carries no decorative motion).

/** Attack time constant: ~95% of a step in ~4 frames at 60fps. */
export const ATTACK_TAU_MS = 22;
/** Release time constant: a full-height bar settles to floor in ~220ms. */
export const RELEASE_TAU_MS = 90;
/** Temporal wobble amplitude (±5% at full voice; ×0 at silence). */
export const WAVE_TEMPORAL_AMP = 0.05;
/** Static per-bar multipliers (mean ≈1, range 0.9–1.1): uneven, not random. */
export const WAVE_JITTER = [
  1.0, 0.92, 1.08, 0.96, 1.05, 0.9, 1.1, 0.94, 1.06, 0.98, 1.04, 0.91, 1.07,
  0.95,
] as const;

/** Voiced energy 0..1 (the wobble's silence gate) from a raw RMS level. */
export function waveVoicedFromRaw(rawLevel: number): number {
  return waveLevelFromRaw(rawLevel);
}

/** Distinct per-bar wobble frequency (3.1–4.58 Hz), deterministic from index. */
export function barFreqHz(index: number): number {
  return 3.1 + (index % 5) * 0.37;
}

/** Golden-angle phase spread so bars decorrelate, deterministic from index. */
export function barPhaseRad(index: number): number {
  return index * 2.39996323;
}

export interface WaveBarsState {
  /** Current envelope value per bar (scale domain). */
  eased: number[];
  /** When the current rising edge began per bar, or -1 while not rising. */
  riseOriginMs: number[];
}

export function initWaveBarsState(barCount = WAVE_PROFILE.length): WaveBarsState {
  return {
    eased: new Array<number>(barCount).fill(WAVE_MIN_SCALE),
    riseOriginMs: new Array<number>(barCount).fill(-1),
  };
}

/**
 * Advance the per-bar envelope one frame. Pure: same inputs → same outputs.
 * Returns the next envelope state plus the 14 displayed scales (envelope ×
 * static jitter × voiced-gated wobble, clamped to [WAVE_MIN_SCALE, 1]).
 */
export function stepWaveBars(
  prev: WaveBarsState,
  target: number,
  voiced: number,
  dtMs: number,
  tMs: number,
): { state: WaveBarsState; shown: number[] } {
  const barCount = prev.eased.length;
  const dt = Math.max(0, dtMs);
  const attackAlpha = 1 - Math.exp(-dt / ATTACK_TAU_MS);
  const releaseAlpha = 1 - Math.exp(-dt / RELEASE_TAU_MS);
  const eased = new Array<number>(barCount);
  const riseOriginMs = new Array<number>(barCount);
  const shown = new Array<number>(barCount);
  for (let i = 0; i < barCount; i++) {
    let value = prev.eased[i] ?? WAVE_MIN_SCALE;
    let origin = prev.riseOriginMs[i] ?? -1;
    if (target > value) {
      // Rising edge: hold until this bar's center-out stagger has elapsed,
      // then ease up fast. Falls below are never staggered.
      if (origin < 0) origin = tMs;
      if (tMs - origin >= waveBarStaggerMs(i, barCount)) {
        value += (target - value) * attackAlpha;
      }
    } else {
      origin = -1;
      value += (target - value) * releaseAlpha;
    }
    eased[i] = value;
    riseOriginMs[i] = origin;
    const wobble =
      WAVE_TEMPORAL_AMP *
      voiced *
      Math.sin(2 * Math.PI * barFreqHz(i) * (tMs / 1000) + barPhaseRad(i));
    const jitter = WAVE_JITTER[i % WAVE_JITTER.length] ?? 1;
    shown[i] = Math.min(1, Math.max(WAVE_MIN_SCALE, value * jitter * (1 + wobble)));
  }
  return { state: { eased, riseOriginMs }, shown };
}

// --- Thinking progress (Typeless-verified mechanism, 2026-06-13) ---
//
// The fill is a JS-driven WIDTH percentage on one persistent element — never a
// translated full-width slab (that made the texture travel and the leading cap
// read as a floating ellipse), and never a second remounted "success" band
// (that flashed). The curve is fast-then-slow and asymptotic: confident early
// motion, then waiting near completion; 100% is reserved for the real terminal
// (the same element snaps to 100% over 100ms linear). The values are Soto's
// own rhythm (deliberately not the reference app's table): 70% by 0.8s, 84% at
// the 1.4s display floor, then a long patient glide toward 99 at 14s.
export const THINKING_PROGRESS_CURVE: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0.8, 70],
  [1.4, 84],
  [2.5, 91],
  [4, 95],
  [7, 97.5],
  [14, 99],
];
export const THINKING_PROGRESS_MAX = 99;

/** Piecewise-linear progress (0..99) for an elapsed thinking time. */
export function thinkingProgressPct(elapsedMs: number): number {
  const t = Math.max(0, elapsedMs / 1000);
  for (let i = 1; i < THINKING_PROGRESS_CURVE.length; i++) {
    const [t1, p1] = THINKING_PROGRESS_CURVE[i] ?? [0, 0];
    const [t0, p0] = THINKING_PROGRESS_CURVE[i - 1] ?? [0, 0];
    if (t <= t1) return p0 + ((t - t0) / (t1 - t0)) * (p1 - p0);
  }
  return THINKING_PROGRESS_MAX;
}

/** Mirrors panelState's clean-success branch: these outcomes show no notice. */
export function isCleanSuccess(result: CompleteResult | null): boolean {
  if (result === null || result.status !== "completed") return false;
  if (result.empty_reason !== undefined) return false;
  const kind = result.injection_outcome.kind;
  return kind === "paste_sent" || kind === "no_op";
}

/** Map the reducer's lifecycle onto the five visual bar states. */
export function barStateFor(
  phase: CapsuleState["phase"],
  result: CompleteResult | null = null,
): BarState {
  switch (phase) {
    case "listening":
      return "listening";
    // Thinking AND inserting share the thinking face: native insertion is a
    // sub-100ms beat (0ms UI settle), so a distinct insert glyph only flickered
    // between the thinking dots and the success check. The dots keep pulsing and
    // the progress band keeps climbing straight into the 100% success snap.
    case "thinking":
    case "inserting":
      return "thinking";
    case "failed":
      return "error";
    case "completed":
      return isCleanSuccess(result) ? "success" : "idle";
    default:
      return "idle"; // idle / cancelled (exit choreography owns the goodbye)
  }
}

export type ModeKind = "default" | "translate" | "custom";

export interface ModeIdentity {
  kind: ModeKind;
  modeId: string;
  /** Intro/badge label; null for the default mode (no intro, no glyph). */
  label: string | null;
}

export function modeIdentityFor(
  modeId: string | null,
  modeName: string | null,
): ModeIdentity {
  const id = modeId ?? "default";
  if (id === "default") return { kind: "default", modeId: id, label: null };
  if (id === "translate") return { kind: "translate", modeId: id, label: modeName };
  return { kind: "custom", modeId: id, label: modeName };
}

/** Compact width for a mode with a leading glyph; intro width fits the label. */
const MODE_COMPACT_WIDTH = 124;
const MODE_INTRO_WIDTH = 178;
export const MODE_INTRO_VISIBLE_MS = 1600;
export const MODE_INTRO_REPEAT_SUPPRESS_MS = 30000;

export function widthFor(
  barState: BarState,
  identity: ModeIdentity,
  introActive: boolean,
): number {
  if (
    identity.kind === "default" ||
    barState === "idle" ||
    barState === "error"
  ) {
    return STATE_WIDTHS[barState];
  }
  return introActive ? MODE_INTRO_WIDTH : MODE_COMPACT_WIDTH;
}

/** Power users chain dictations — don't replay the intro within 30s. */
export function shouldShowIntro(
  identity: ModeIdentity,
  last: { modeId: string; at: number } | null,
  now: number,
): boolean {
  if (identity.kind === "default" || identity.label === null) return false;
  if (last === null || last.modeId !== identity.modeId) return true;
  return now - last.at >= MODE_INTRO_REPEAT_SUPPRESS_MS;
}

/**
 * Time the DOM exit to END exactly at the window-hide instant (`inMs` after the
 * will-hide push), so win.hide() lands on an already-transparent frame.
 */
export function exitPlanFor(exit: CapsuleExitIntent, inMs: number): ExitPlan {
  const variant = exit === "cancel" ? "fast" : "sink";
  const wanted = variant === "fast" ? EXIT_FAST_MS : EXIT_SINK_MS;
  const durationMs = Math.min(wanted, Math.max(0, inMs));
  return { variant, startMs: Math.max(0, inMs - durationMs), durationMs };
}

/**
 * Vertical scale applied to every wave bar, driven by live mic level.
 * Volume responsiveness: scale by the local meter level (falling back to the
 * wire `level` event's rms for windows that did not run the capture). The input
 * is raw RMS, so use a vocal-range display curve: tiny noise stays near the
 * visible floor while ordinary speech reaches the medium/high visual bands.
 * Only the `listening` state reacts; every other state pins to the quiet floor.
 */
export function computeWaveScale(
  barState: BarState,
  localLevel: number,
  wireRms: number,
): number {
  if (barState !== "listening") return WAVE_MIN_SCALE;
  const level = Math.max(clamp01(localLevel), normalizeLevel(wireRms));
  return WAVE_MIN_SCALE + (1 - WAVE_MIN_SCALE) * waveLevelFromRaw(level);
}

export function quantizeWaveScale(scale: number): number {
  let best: number = WAVE_SCALE_STEPS[0];
  for (const step of WAVE_SCALE_STEPS) {
    if (Math.abs(step - scale) < Math.abs(best - scale)) best = step;
  }
  return best;
}
