import {
  memo,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type Ref,
  type RefObject,
  type ReactNode,
} from "react";

import {
  ARIA_LABELS,
  SUCCESS_BAND_SPRINT_MS,
  THINKING_PROGRESS_MAX,
  WAVE_MIN_SCALE,
  WAVE_PROFILE,
  REDUCED_MOTION_METER_INTERVAL_MS,
  computeWaveScale,
  initWaveBarsState,
  quantizeWaveScale,
  stepWaveBars,
  thinkingProgressPct,
  waveVoicedFromRaw,
  type BarState,
  type ModeIdentity,
  type ModeKind,
  widthFor,
} from "./capsuleMeterModel";

// Pure presentational equalizer for the recording capsule (audit §3.2 step 13).
// Given the current visual state and a *ref* to the live mic level, it draws one
// of four faces — idle dot / wave / thinking / error — and nothing else: no IO,
// no Web Audio, no IPC. The capture-driver lifecycle lives in useCaptureDriver;
// this component is display-only (no buttons) to match the original VoiceCapsule.
//
// Perf (PR3 §3.1): the mic level updates ~30 Hz. Rather than re-rendering on each
// frame, the meter reads `localLevelRef.current` inside a requestAnimationFrame
// loop and writes the wave scale onto a CSS variable directly on the DOM node, so
// a level change costs ZERO React renders. The component is wrapped in React.memo
// and only re-renders when `barState` changes (the ref identity is stable). The
// scale math is unchanged — `computeWaveScale` is still the single source of the
// wave's vertical scale, so the meter is visually identical to before.

/** Inline CSS custom properties (cast since React.CSSProperties rejects --vars). */
function vars(props: Record<string, string>): CSSProperties {
  return props as CSSProperties;
}

// The wave bars' heights are pure functions of the bar index, so precompute the
// 14 per-bar style objects ONCE at module scope instead of rebuilding them on
// every render. Per-bar MOTION (envelope + stagger + jitter) is written by the
// rAF loop directly onto each bar's inline transform — not via styles here.
const WAVE_BAR_STYLES: readonly CSSProperties[] = WAVE_PROFILE.map((profile) =>
  vars({
    "--voice-capsule-wave-bar-height": `${profile * 100}%`,
  }),
);

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

function renderFace(
  barState: BarState,
  identity: ModeIdentity,
  waveRef?: Ref<HTMLSpanElement>,
): JSX.Element | null {
  switch (barState) {
    case "idle":
      return <span aria-hidden className="voice-capsule-idle-dot" />;

    case "listening":
      return (
        <span ref={waveRef} aria-hidden className="voice-capsule-wave">
          {WAVE_BAR_STYLES.map((style, i) => (
            <span key={i} className="voice-capsule-wave-bar" style={style} />
          ))}
        </span>
      );

    // NOTE: the progress track/band is NOT part of the face — it is one
    // persistent element spanning thinking AND success (rendered at the pill
    // level), so the terminal never remounts/flashes the fill. The face only
    // carries the small center content.
    case "thinking":
      return identity.kind === "translate" ? (
        <span aria-hidden className="voice-capsule-translate-swap">
          <b>A</b>
          <b>文</b>
        </span>
      ) : (
        <span aria-hidden className="voice-capsule-thinking-dots">
          {[0, 1, 2].map((d) => (
            <span
              key={d}
              className="voice-capsule-thinking-dot"
              style={vars({ "--voice-capsule-thinking-dot-delay": `${d * 0.18}s` })}
            />
          ))}
        </span>
      );

    case "success":
      return (
        <span aria-hidden className="voice-capsule-check">
          <svg viewBox="0 0 12 12" width="12" height="12">
            <polyline
              points="2,6.5 5,9 10,3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      );

    case "error":
      return (
        <span aria-hidden className="voice-capsule-error-glyph">
          !
        </span>
      );
  }
}

function modeGlyph(kind: ModeKind): JSX.Element {
  if (kind === "translate") {
    return (
      <svg viewBox="0 0 14 14" width="13" height="13" className="voice-capsule-mode-glyph">
        <text x="1" y="10" fontSize="9" fill="currentColor">
          文
        </text>
        <text x="7.5" y="13" fontSize="8" fill="currentColor">
          A
        </text>
      </svg>
    );
  }
  return <span className="voice-capsule-mode-glyph-dot" />;
}

function ariaLabelFor(barState: BarState, identity: ModeIdentity): string {
  if (identity.kind === "translate" && barState === "thinking") {
    return "Translating";
  }
  return ARIA_LABELS[barState];
}

export interface CapsuleMeterProps {
  /** Current visual state (already projected from the reducer phase). */
  barState: BarState;
  /**
   * Live mic level (0..1) as a ref. Read inside a rAF loop and projected onto the
   * wave's CSS variable; a stable ref means level updates never re-render the meter.
   */
  localLevelRef: RefObject<number>;
  identity: ModeIdentity;
  introActive: boolean;
  children?: ReactNode;
}

function CapsuleMeterImpl({
  barState,
  localLevelRef,
  identity,
  introActive,
  children,
}: CapsuleMeterProps): JSX.Element {
  const waveRef = useRef<HTMLSpanElement | null>(null);
  const bandRef = useRef<HTMLSpanElement | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const [outgoing, setOutgoing] = useState<BarState | null>(null);
  const prevBarStateRef = useRef(barState);
  useEffect(() => {
    const prev = prevBarStateRef.current;
    prevBarStateRef.current = barState;
    if (prev === barState || prev === "idle") return;
    setOutgoing(prev);
    const t = setTimeout(() => setOutgoing(null), 160);
    return () => clearTimeout(t);
  }, [barState]);

  // Drive the bars entirely in JS, off React's render path. Keyed on
  // `barState`: while "listening" a free-running rAF loop reads the level ref
  // each frame, advances the pure asymmetric envelope (fast attack, slower
  // release, center-out attack stagger, voiced-gated micro-jitter — see
  // stepWaveBars), and writes each bar's inline transform directly. The bars
  // carry `transition: none`, so each write lands instantly — the envelope IS
  // the smoothing. Reduced motion keeps the WCAG stepped path: a 500ms
  // interval writing one shared quantized scale to all bars, no envelope, no
  // jitter, no continuous motion. The rAF/interval handle is cancelled on
  // cleanup, so no loop is ever leaked.
  useEffect(() => {
    const el = waveRef.current;
    if (!el || barState !== "listening") return;

    const bars = Array.from(
      el.querySelectorAll<HTMLSpanElement>(".voice-capsule-wave-bar"),
    );
    const writeAll = (scales: readonly number[]): void => {
      for (let i = 0; i < bars.length; i++) {
        const bar = bars[i];
        if (bar) {
          bar.style.transform = `scaleY(${(scales[i] ?? WAVE_MIN_SCALE).toFixed(3)})`;
        }
      }
    };

    if (reducedMotion) {
      const writeQuantized = (): void => {
        const scale = quantizeWaveScale(
          computeWaveScale("listening", localLevelRef.current ?? 0, 0),
        );
        writeAll(bars.map(() => scale));
      };
      writeQuantized();
      const interval = setInterval(writeQuantized, REDUCED_MOTION_METER_INTERVAL_MS);
      return () => clearInterval(interval);
    }

    // Fresh envelope per listening entry: never inherit a stale rise.
    let state = initWaveBarsState(bars.length);
    let last = performance.now();
    writeAll(state.eased);

    let raf = 0;
    const tick = (): void => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      const level = localLevelRef.current ?? 0;
      const target = computeWaveScale("listening", level, 0);
      const voiced = waveVoicedFromRaw(level);
      const next = stepWaveBars(state, target, voiced, dt, now);
      state = next.state;
      writeAll(next.shown);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(raf);
  }, [barState, localLevelRef, reducedMotion]);

  // Thinking progress — Typeless-verified mechanism: JS writes a WIDTH
  // percentage on ONE persistent band (no CSS animation, no translate, no
  // remount). The curve is fast-then-slow (80% at 1s) and asymptotic at 99%;
  // the SAME element snaps to 100% over 100ms linear when success lands, so
  // there is no end-of-fill flash. Reduced motion: a 500ms stepped readout.
  useEffect(() => {
    const band = bandRef.current;
    if (!band) return;

    if (barState === "success") {
      band.style.transition = `width ${SUCCESS_BAND_SPRINT_MS}ms linear`;
      band.style.width = "100%";
      return;
    }
    if (barState !== "thinking") return;

    band.style.transition = "none";
    band.style.width = "0%";
    const startedAt = performance.now();
    const write = (): number => {
      const pct = thinkingProgressPct(performance.now() - startedAt);
      band.style.width = `${pct.toFixed(2)}%`;
      return pct;
    };

    if (reducedMotion) {
      write();
      const interval = setInterval(write, REDUCED_MOTION_METER_INTERVAL_MS);
      return () => clearInterval(interval);
    }

    let raf = 0;
    const tick = (): void => {
      // Stop scheduling at the asymptote (~14s); past it the thinking dots
      // (or the A⇄文 swap) carry the liveness, and the 8s/20s slow notices speak.
      if (write() < THINKING_PROGRESS_MAX) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [barState, reducedMotion]);

  return (
    <div
      className="voice-capsule"
      data-state={barState}
      data-mode={identity.kind}
      data-handoff={outgoing !== null ? "true" : undefined}
      aria-label={ariaLabelFor(barState, identity)}
      style={vars({ "--voice-capsule-width": `${widthFor(barState, identity, introActive)}px` })}
    >
      {(barState === "thinking" || barState === "success") && (
        <span aria-hidden className="voice-capsule-thinking-track">
          <span ref={bandRef} className="voice-capsule-thinking-band" />
        </span>
      )}
      {identity.kind !== "default" &&
        barState !== "idle" &&
        barState !== "error" && (
          <span aria-hidden className="voice-capsule-mode-badge">
            {modeGlyph(identity.kind)}
            {introActive && identity.label !== null && (
              <span className="voice-capsule-mode-label">{identity.label}</span>
            )}
          </span>
        )}
      {children ?? renderFace(barState, identity, waveRef)}
      {outgoing !== null && (
        <span aria-hidden className="voice-capsule-face-exit">
          {renderFace(outgoing, identity)}
        </span>
      )}
    </div>
  );
}

// Memoized: level updates flow through localLevelRef (stable identity) + rAF, so
// the meter only re-renders when `barState` changes (a phase transition).
export const CapsuleMeter = memo(CapsuleMeterImpl);
