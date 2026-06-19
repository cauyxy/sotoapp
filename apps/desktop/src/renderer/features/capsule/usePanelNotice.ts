import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import {
  initialPanelState,
  panelActionForVoiceEvent,
  panelAutoDismissDelayMs,
  panelReducer,
  type PanelState,
  type VoiceRuntimeEvent,
} from "@soto/core";

const PANEL_EXIT_MS = 160;
/** Re-read floor after un-hovering (mirrors main's RESUME_HIDE_FLOOR_MS). */
const HOVER_RESUME_FLOOR_MS = 1500;

export interface PanelNoticeDriver {
  /**
   * Notification state shown above the capsule. The reducer is pure and lives in
   * @soto/core; this hook owns only renderer lifecycle concerns.
   */
  panel: PanelState;
  /** True while the current notice plays its exit animation (still rendered). */
  exiting: boolean;
  /** Feed the panel from the same voice-runtime stream as the capsule reducer. */
  dispatchPanelEvent: (event: VoiceRuntimeEvent) => void;
  /** Begin the exit, then dismiss (the "知道了" or primary-action button). */
  dismissPanel: () => void;
  /**
   * Hard-clear any notice with no exit animation. Called on the window's
   * will-show so a notice that outlived its window (e.g. chord-dismissed, no
   * `started` followed) can never flash on the next session's reveal.
   */
  clearPanel: () => void;
  /** Toggle whether the click-through capsule overlay can receive mouse clicks. */
  setPanelInteractive: (interactive: boolean) => void;
}

export interface PanelNoticeDriverOptions {
  setCapsuleInteractive?: (interactive: boolean) => void;
  /** Report a USER-initiated dismissal so main can expedite the window hide. */
  noticeDismissed?: () => void;
}

export function usePanelNotice({
  setCapsuleInteractive,
  noticeDismissed,
}: PanelNoticeDriverOptions): PanelNoticeDriver {
  const [panel, panelDispatch] = useReducer(panelReducer, initialPanelState);
  const [exiting, setExiting] = useState(false);
  const deadlineRef = useRef<number | null>(null);
  const remainingRef = useRef<number | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  /** Whether the pointer is currently over the panel (set via setPanelInteractive). */
  const hoveredRef = useRef(false);
  const prevNoticeIdRef = useRef<string | null>(null);

  const clearPanelTimers = useCallback(() => {
    for (const t of timersRef.current) clearTimeout(t);
    timersRef.current = [];
  }, []);

  const dispatchPanelEvent = useCallback((event: VoiceRuntimeEvent): void => {
    const action = panelActionForVoiceEvent(event);
    if (action !== null) panelDispatch(action);
  }, []);

  const scheduleDismiss = useCallback(
    (inMs: number, noticeId: string) => {
      clearPanelTimers();
      deadlineRef.current = Date.now() + inMs;
      timersRef.current.push(
        setTimeout(() => setExiting(true), Math.max(0, inMs - PANEL_EXIT_MS)),
        setTimeout(() => panelDispatch({ kind: "dismiss", id: noticeId }), inMs),
      );
    },
    [clearPanelTimers],
  );

  useEffect(() => {
    setExiting(false);
    const notice = panel.notice;
    if (notice === null) return;
    const delayMs = panelAutoDismissDelayMs(notice);
    if (delayMs === null) return;
    scheduleDismiss(delayMs + PANEL_EXIT_MS, notice.id);
    return clearPanelTimers;
  }, [panel.seq, panel.notice, scheduleDismiss, clearPanelTimers]);

  useEffect(() => {
    // Reset to click-through on every notice change — EXCEPT a same-id
    // replace-in-place under a hovering pointer (e.g. the slow notice
    // escalating with the Esc hint at 20s): yanking interactivity off under a
    // stationary pointer would dead-zone clicks until the pointer re-enters,
    // because React only re-fires mouseenter on actual movement.
    const nextId = panel.notice?.id ?? null;
    const sameId = nextId !== null && nextId === prevNoticeIdRef.current;
    prevNoticeIdRef.current = nextId;
    if (hoveredRef.current && sameId) return;
    setCapsuleInteractive?.(false);
  }, [panel.seq, panel.notice, setCapsuleInteractive]);

  const dismissPanel = useCallback(() => {
    const notice = panel.notice;
    if (notice === null) return;
    hoveredRef.current = false; // the pointer's panel is leaving with the notice
    scheduleDismiss(PANEL_EXIT_MS, notice.id); // local 160ms exit
    // Tell main to expedite the window hide (no-op during a live recording).
    // Auto-dismiss (the timer effect above) deliberately never calls this —
    // only a user gesture collapses the whole overlay early.
    noticeDismissed?.();
  }, [panel.notice, scheduleDismiss, noticeDismissed]);

  const setPanelInteractive = useCallback(
    (interactive: boolean) => {
      hoveredRef.current = interactive;
      setCapsuleInteractive?.(interactive);
      if (panel.notice === null || panelAutoDismissDelayMs(panel.notice) === null) return;
      if (interactive) {
        remainingRef.current =
          deadlineRef.current !== null ? Math.max(0, deadlineRef.current - Date.now()) : null;
        clearPanelTimers();
        setExiting(false);
      } else if (remainingRef.current !== null) {
        scheduleDismiss(
          Math.max(remainingRef.current, HOVER_RESUME_FLOOR_MS),
          panel.notice.id,
        );
        remainingRef.current = null;
      }
    },
    [setCapsuleInteractive, panel.notice, clearPanelTimers, scheduleDismiss],
  );

  const clearPanel = useCallback(() => {
    clearPanelTimers();
    setExiting(false);
    panelDispatch({ kind: "clear" });
  }, [clearPanelTimers]);

  return { panel, exiting, dispatchPanelEvent, dismissPanel, clearPanel, setPanelInteractive };
}
