import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type MutableRefObject,
} from "react";

import {
  capsuleReducer,
  initialCapsuleState,
  type CapsuleState,
  type PanelState,
} from "@soto/core";

import { MicCapture, MicPermissionError } from "./audio/capture.js";
import { getCapsuleBridge } from "./capsuleBridge";
import { exitPlanFor, type CapsuleExitIntent } from "./capsuleMeterModel";
import { createLevelThrottle } from "./levelThrottle.pure";
import { CUE_LEAD_MS, recordingCues } from "./recordingCues";
import { usePanelNotice } from "./usePanelNotice";

// Renderer-side capture driver for the recording capsule (audit §3.2 step 13 /
// `capsule-capture-driver-vs-view`). This hook owns the runtime-only glue that
// was braided into capsule.tsx — Web Audio / getUserMedia lifecycle, the
// idempotent + stale-session guards, and the ~30 Hz level throttle — leaving the
// <CapsuleMeter> view purely presentational. It does two things:
//
//  1. Reflects the recording lifecycle by feeding `soto://voice-runtime` events
//     into @soto/core's pure capsuleReducer (idle/listening/thinking/done/err)
//     and exposing the state for the meter.
//
//  2. Drives the renderer-side mic capture: on a main->renderer capture-control
//     `begin` it spins up a MicCapture (streaming level frames back), and on the
//     user pressing finish/cancel (or a control `cancel`) it stops/cancels and
//     pushes the WAV back to main. This is the capture-driver contract the
//     SessionController documents in preload/capsule.ts — runtime-only glue
//     (Web Audio / getUserMedia), exercised by launching the app.
//
// The capsule bridge (window.soto) is resolved here rather than passed in, so the
// subscriptions below read as the genuine external subscriptions they are rather
// than data pushed back through a prop callback (react-doctor/no-pass-data-to-parent).

function nextPaintFrame(): Promise<void> {
  if (typeof requestAnimationFrame !== "function") return Promise.resolve();
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

interface CaptureControlEvent {
  kind: "begin" | "finish" | "cancel";
  session_id: string;
  mode_id?: string;
  device_id?: string | null;
}

type CapsuleOverlayPush =
  | { kind: "will-show"; seq: number }
  | {
      kind: "will-hide";
      seq: number;
      in_ms: number;
      exit?: CapsuleExitIntent;
    };

/** Window choreography surfaced to the view. */
export interface OverlayLifecycle {
  /** Bumped per show — used as a React key so enter animations re-run. */
  showSeq: number;
  /** null → resting; otherwise the running exit (drives stack data-attrs). */
  exit: { variant: "sink" | "fast"; durationMs: number } | null;
  /** True briefly before a sticky notice's window deadline (pre-departure dim). */
  departing: boolean;
}

// The ~30 Hz peak-hold throttle for the live level meter and its outbound IPC
// push lives in levelThrottle.pure.ts; see the note in beginCapture.

export interface CaptureDriver {
  /** The pure capsule lifecycle state, driven by `soto://voice-runtime` events. */
  state: CapsuleState;
  /**
   * Live mic level (0..1) as a *ref*, written directly off the local MicCapture
   * onLevel callback. It is deliberately NOT React state: at ~30 Hz a setState
   * would re-render the capsule every frame. The meter reads `.current` inside a
   * requestAnimationFrame loop and writes a CSS variable, so a level change costs
   * zero React renders. Independent of the reducer's wire `level` events (which
   * exist mainly for windows that didn't run the capture and are now dropped here
   * to avoid the echo re-render).
   */
  localLevelRef: MutableRefObject<number>;
  /** Notification state shown above the capsule, driven by the panel notice hook. */
  panel: PanelState;
  /** True while the current Panel notice is playing its exit keyframe. */
  panelExiting: boolean;
  /** Manually dismiss the current Panel notice (the "知道了" or primary-action button). */
  dismissPanel: () => void;
  noticeAction: (id: "copy_text" | "open_permission_settings") => void;
  /**
   * Toggle whether the click-through overlay momentarily captures the mouse, so
   * the Panel dismiss button is clickable while hovered (main flips
   * setIgnoreMouseEvents). Pass true on hover-enter, false on leave.
   */
  setCapsuleInteractive: (interactive: boolean) => void;
  /** Window-edge enter/exit lifecycle projected from the main overlay channel. */
  overlay: OverlayLifecycle;
}

export function useCaptureDriver(): CaptureDriver {
  // window.soto is injected by preload before the renderer mounts and never
  // changes identity, so this is a stable value for the subscription deps below.
  const bridge = getCapsuleBridge();

  // Reset wrapper: will-show must clear a stale terminal face BEFORE the window
  // reveals (the reducer only resets on `started`, which arrives later).
  type CapsuleAction = Parameters<typeof capsuleReducer>[1] | { kind: "__reset" };
  const [state, dispatch] = useReducer(
    (s: CapsuleState, a: CapsuleAction): CapsuleState =>
      a.kind === "__reset" ? initialCapsuleState : capsuleReducer(s, a),
    initialCapsuleState,
  );
  const [overlay, setOverlay] = useState<OverlayLifecycle>({
    showSeq: 0,
    exit: null,
    departing: false,
  });
  const exitTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Live mic level lives in a ref, not state: at ~30 Hz a setState would re-render
  // the capsule every frame. The meter reads this ref in a rAF loop (see
  // CapsuleMeter) so a level update is zero React renders.
  const localLevelRef = useRef(0);

  const setCapsuleInteractiveForPanel = useCallback(
    (interactive: boolean) => bridge?.setCapsuleInteractive?.(interactive),
    [bridge],
  );
  const noticeDismissedForPanel = useCallback(
    () => bridge?.noticeDismissed?.(),
    [bridge],
  );
  const noticeActionForPanel = useCallback(
    (id: "copy_text" | "open_permission_settings") => bridge?.noticeAction?.(id),
    [bridge],
  );
  const {
    panel,
    exiting: panelExiting,
    dispatchPanelEvent,
    dismissPanel,
    clearPanel,
    setPanelInteractive,
  } = usePanelNotice({
    setCapsuleInteractive: setCapsuleInteractiveForPanel,
    noticeDismissed: noticeDismissedForPanel,
  });

  const captureRef = useRef<MicCapture | null>(null);
  const sessionRef = useRef<string | null>(null);
  // Peak-hold ~30Hz gate for onLevel below (pure, tested in levelThrottle.pure).
  const levelThrottleRef = useRef(createLevelThrottle());

  useEffect(() => {
    if (!bridge?.onCapsuleOverlay) return;
    const clearExitTimers = () => {
      for (const t of exitTimersRef.current) clearTimeout(t);
      exitTimersRef.current = [];
    };
    const unsubscribe = bridge.onCapsuleOverlay((payload) => {
      const e = payload as CapsuleOverlayPush;
      if (e.kind === "will-show") {
        clearExitTimers();
        dispatch({ kind: "__reset" });
        // The panel reducer is independent of the capsule reducer and only
        // clears on `started`/dismiss — a notice that outlived its window
        // (chord-dismissed, no started followed) must not flash on reveal.
        clearPanel();
        setOverlay({ showSeq: e.seq, exit: null, departing: false });
        return;
      }
      // will-hide: schedule the exit to END at the hide instant; a later
      // will-hide (hover-resume re-announce) replaces the schedule.
      clearExitTimers();
      const inMs = e.in_ms ?? 0;
      const plan = exitPlanFor(e.exit ?? "default", inMs);
      if (inMs > 3000) {
        const dim = setTimeout(
          () => setOverlay((o) => ({ ...o, departing: true })),
          Math.max(0, inMs - 1500),
        );
        exitTimersRef.current.push(dim);
      }
      const start = setTimeout(
        () =>
          setOverlay((o) => ({
            ...o,
            exit: { variant: plan.variant, durationMs: plan.durationMs },
          })),
        plan.startMs,
      );
      exitTimersRef.current.push(start);
    });
    return () => {
      clearExitTimers();
      unsubscribe();
    };
  }, [bridge, clearPanel]);

  // begin/finish/cancel close over only stable refs/setters plus `bridge`, so
  // useCallback keeps them stable per-bridge. That lets the capture-control
  // subscription below list them as deps (exhaustive-deps) yet re-subscribe only
  // when the bridge identity changes — not on every render.
  const beginCapture = useCallback(
    async (e: CaptureControlEvent): Promise<void> => {
      if (!bridge) return;

      // Tear down any stale capture before starting a fresh one.
      await captureRef.current?.cancel().catch(() => undefined);
      sessionRef.current = e.session_id;
      localLevelRef.current = 0;
      levelThrottleRef.current.reset();

      const mic = new MicCapture({
        deviceId: e.device_id ?? undefined,
        // onLevel fires per audio render quantum (~375 Hz). Pushing an IPC round-trip
        // every quantum — which main re-emits back as a `level` event, a second
        // capsule re-render — floods the renderer<->main boundary during the most
        // latency-sensitive moment (Tenet 6: cross boundaries intentionally). The
        // peak-hold throttle caps the local meter and the outbound push at ~30 Hz
        // while keeping the MAX level seen in each window, so a syllable-onset
        // transient between emits is never discarded (the old drop-gate made the
        // wave feel deaf). IPC stays at <=30 emits/s. WAVE_PROFILE/STATE_WIDTHS
        // (the wave *shape*) are untouched — that is muscle-memory identity (Tenet 7).
        onLevel: (level) => {
          const peak = levelThrottleRef.current.sample(level, performance.now());
          if (peak === null) return;
          // Ref write only — no setState. The meter's rAF loop reads this ref and
          // drives the wave's CSS variable, so a level frame is zero React renders.
          localLevelRef.current = peak;
          void bridge.push_capture_level({ session_id: e.session_id, level: peak });
        },
      });
      captureRef.current = mic;

      try {
        await mic.start();
        // The mic truly opened → recording has REALLY started. Play the start
        // cue now (a permission failure throws above and never reaches here, so
        // the cue can't mis-fire). Then let the cue ring out before we ack
        // capture_started — main mutes background media on that ack, so the lead
        // keeps the device mute from clipping our own cue (the cue is a renderer
        // HTMLAudio element, decoupled from the native mute). If the session was
        // cancelled/replaced during the lead, skip the ack (and thus the mute).
        recordingCues().started();
        await new Promise((resolve) => setTimeout(resolve, CUE_LEAD_MS));
        if (sessionRef.current !== e.session_id) return;
        void bridge.capture_started({ session_id: e.session_id });
      } catch (err) {
        captureRef.current = null;
        recordingCues().abort();
        const message =
          err instanceof MicPermissionError
            ? err.message
            : `Capture failed: ${String((err as Error)?.message ?? err)}`;
        void bridge.report_capture_error({ session_id: e.session_id, message });
      }
    },
    [bridge],
  );

  // Stop capture and push the encoded WAV back to main for transcription. Called
  // both by the hotkey toggle's `finish` capture-control and the ✓ button, so it
  // is idempotent: a second finish (button + hotkey, or a fast repeat) sees a
  // nulled captureRef and no-ops rather than routing to a dead stub. When an
  // explicit session id is supplied (the `finish` event), only the matching
  // session is finished — a stale finish for a past session is ignored.
  const finishCapture = useCallback(
    async (sessionId?: string): Promise<void> => {
      if (!bridge) return;

      const mic = captureRef.current;
      const current = sessionRef.current;
      if (!mic || current === null) return; // already finished/cancelled — no-op.
      if (sessionId !== undefined && sessionId !== current) return; // stale.
      captureRef.current = null;
      sessionRef.current = null;
      localLevelRef.current = 0;
      levelThrottleRef.current.reset();
      try {
        await nextPaintFrame();
        const result = await mic.stop();
        // The mic truly closed → recording has REALLY stopped. Play the stop cue
        // (gate-guarded play-once, so a repeated/stale finish never double-plays).
        // Main already unmuted media on the finish control before the renderer
        // reached here, so the stop cue is audible.
        recordingCues().stopped();
        void bridge.push_capture_audio({
          session_id: current,
          wav_base64: result.wavBase64,
          duration_ms: result.durationMs,
          peak: result.peak,
          voiced_ms: result.voicedMs,
        });
      } catch (err) {
        recordingCues().abort();
        void bridge.report_capture_error({
          session_id: current,
          message: `Encode failed: ${String((err as Error)?.message ?? err)}`,
        });
      }
    },
    [bridge],
  );

  // Discard the live capture. Idempotent + session-guarded so a stale cancel for
  // a past session does not tear down a freshly-started one (a fast double-tap
  // can race a cancel for session A against a begin for session B).
  const cancelCapture = useCallback(
    async (sessionId?: string): Promise<void> => {
      const current = sessionRef.current;
      if (sessionId !== undefined && current !== null && sessionId !== current) {
        return; // cancel for a different (stale) session — leave the live one alone.
      }
      const mic = captureRef.current;
      captureRef.current = null;
      sessionRef.current = null;
      localLevelRef.current = 0;
      levelThrottleRef.current.reset();
      // Abort ends the cue gate silently — no stop cue on a cancel, and a later
      // spurious stop is suppressed.
      recordingCues().abort();
      await mic?.cancel().catch(() => undefined);
    },
    [],
  );

  // 1. Reducer fanout: the same voice-runtime event drives BOTH the capsule
  //    reducer (its core lifecycle face) and the panel notice driver
  //    (notifications), kept independent so a capsule phase change never leaves
  //    stale panel text and vice-versa.
  useEffect(() => {
    if (!bridge) return;
    const unsubscribe = bridge.onVoiceRuntime((payload) => {
      const event = payload as Parameters<typeof capsuleReducer>[1];
      // `level` events are the throttled mic-level echo of THIS window's own
      // push_capture_level (main re-broadcasts them). The live meter is driven
      // off localLevelRef via rAF, so dispatching them here would only re-render
      // the capsule ~30x/s for no visible change. Drop them; every phase/result
      // event still flows to the reducer and panel. (The reducer's `case 'level'`
      // in @soto/core stays as harmless-unreachable-for-this-window state.)
      if (event.kind === "level") return;
      dispatch(event);
      dispatchPanelEvent(event);
    });
    return unsubscribe;
  }, [bridge, dispatchPanelEvent]);

  // 2. Capture driver: react to main->renderer capture-control. The hotkey
  //    toggle drives stop+push via `finish`; `cancel` tears the mic down. The
  //    capsule itself is display-only (no buttons) to match the original design.
  useEffect(() => {
    if (!bridge) return;
    const unsubscribe = bridge.onCaptureControl((payload) => {
      const e = payload as CaptureControlEvent;
      if (e.kind === "begin") {
        void beginCapture(e);
      } else if (e.kind === "finish") {
        void finishCapture(e.session_id);
      } else {
        void cancelCapture(e.session_id);
      }
    });
    return unsubscribe;
  }, [bridge, beginCapture, finishCapture, cancelCapture]);

  return {
    state,
    localLevelRef,
    panel,
    panelExiting,
    dismissPanel,
    noticeAction: noticeActionForPanel,
    setCapsuleInteractive: setPanelInteractive,
    overlay,
  };
}
