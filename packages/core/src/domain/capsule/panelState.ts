// Pure Panel notice model (capsule/panel responsibility split).
//
// The recording **capsule** shows ONLY the core lifecycle face (idle / listening
// / thinking / done) — see capsuleState.ts. Every *notification* (errors, empty
// results, permission prompts, focus-changed copies, long-form hints) is the
// **Panel's** job: a separate surface stacked above the capsule that is hidden by
// default and only appears when there is something extended to say.
//
// This module is the single source of truth for that Panel state. It is a plain,
// pure reducer (no React, no IO) so it can be unit-tested without a DOM and fed
// from the same `soto://voice-runtime` stream the capsule reducer consumes. The
// capsule reducer and this panel reducer are deliberately INDEPENDENT: a capsule
// phase change never leaves stale panel text, and a burst of notices can never
// garble the panel because it is a single "latest wins" slot with a monotonic
// sequence the host keys its auto-dismiss timer on.

import type { VoiceRuntimeErrorCode, VoiceRuntimeEvent } from "../../contract/events.js";

/** The kind of notice — drives the Panel's accent + icon, not its text. */
export type PanelNoticeType = "error" | "info" | "success" | "permission" | "longform";

/**
 * How a notice leaves the Panel:
 *  - "auto"       — disappears after `durationMs`.
 *  - "until_next" — stays until the next notice replaces it or a new session
 *                   clears it (used for sticky errors like missing_provider).
 *  - "manual"     — only a user dismiss / clear removes it.
 */
export type PanelDismissPolicy = "auto" | "until_next" | "manual";

export interface PanelNotice {
  /** Stable id; a repeat push with the same id replaces in place (no flicker). */
  id: string;
  type: PanelNoticeType;
  /** Short headline (always present). */
  message: string;
  /** Optional extended detail shown under the headline. */
  detail?: string;
  /** Auto-dismiss delay in ms; `<= 0` or non-finite means "no auto-dismiss". */
  durationMs: number;
  dismissPolicy: PanelDismissPolicy;
  primaryAction?: PanelNoticePrimaryAction;
}

export interface PanelNoticePrimaryAction {
  id: "copy_text" | "open_permission_settings";
  label: string;
}

export interface PanelState {
  /** The single notice currently shown, or null when the Panel is hidden. */
  notice: PanelNotice | null;
  /**
   * Monotonic change counter. Bumped on EVERY state change (push/replace/clear).
   * The renderer keys its auto-dismiss timer on `seq` so a stale timer from a
   * superseded notice can detect it lost the slot and no-op — this is what keeps
   * rapid consecutive notices from garbling the Panel.
   */
  seq: number;
}

export const initialPanelState: PanelState = { notice: null, seq: 0 };

/** Default auto-dismiss for transient notices (long enough to read comfortably). */
export const PANEL_DEFAULT_DURATION_MS = 7000;
/** Errors linger longer so they are readable. */
export const PANEL_ERROR_DURATION_MS = 10000;
/**
 * How long to keep a sticky (until_next) notice visible when the capsule window
 * would otherwise hide — e.g. missing_provider. The notice itself does not
 * auto-dismiss, but the capsule window can't stay up forever, so this bounds it.
 */
export const STICKY_NOTICE_LINGER_MS = 12000;
/**
 * Extra window-visible margin past a notice's own deadline so the RENDERER owns
 * the dismissal beat: the Panel plays its 160ms exit (plus slack for IPC/paint)
 * and the window hides onto an already-empty frame instead of beheading it.
 */
export const PANEL_EXIT_MARGIN_MS = 450;

export type PanelAction =
  | { kind: "push"; notice: PanelNotice }
  // Dismiss the current notice. With `id`, only dismiss when it still matches
  // (a stale auto-dismiss timer for a replaced notice becomes a no-op).
  | { kind: "dismiss"; id?: string }
  // Unconditionally hide the Panel (e.g. a new recording session starting).
  | { kind: "clear" };

/**
 * Pure reducer. Always returns the same reference when nothing changes (so React
 * can bail out of a re-render) and a fresh object — with `seq` bumped — on every
 * real change. Never mutates its input.
 */
export function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.kind) {
    case "push":
      return { notice: action.notice, seq: state.seq + 1 };

    case "dismiss":
      if (state.notice === null) return state;
      if (action.id !== undefined && state.notice.id !== action.id) return state;
      return { notice: null, seq: state.seq + 1 };

    case "clear":
      if (state.notice === null) return state;
      return { notice: null, seq: state.seq + 1 };
  }
}

// --- Voice-runtime → Panel mapping ----------------------------------------
//
// The Panel is fed from the SAME event stream as the capsule. This mapper turns
// a voice-runtime event into the Panel action it implies (or null when the event
// changes the capsule only). The renderer dispatches the capsule reducer AND, on
// a non-null result here, the panel reducer — so the two stay in lock-step yet
// independent.

function emptyReasonNotice(reason: string): PanelNotice {
  const detail =
    reason === "too_short"
      ? "The recording was too short to transcribe."
      : reason === "silent"
        ? "No speech was detected."
        : "Nothing was recognized.";
  return {
    id: "session:empty",
    type: "info",
    message: "Nothing to insert",
    detail,
    durationMs: PANEL_DEFAULT_DURATION_MS,
    dismissPolicy: "auto",
  };
}

// The "still working..." reassurance for a long thinking phase. Sticky: it stays
// until the terminal event's own action replaces/clears it. The 20s escalation
// repushes the same id with the Esc hint (replace-in-place, no flicker).
function slowNotice(modeId: string, elapsedMs: number): PanelNotice {
  return {
    id: "session:slow",
    type: "info",
    message: modeId === "translate" ? "Still translating…" : "Still transcribing…",
    ...(elapsedMs >= 20000 ? { detail: "Press Esc to cancel." } : {}),
    durationMs: 0,
    dismissPolicy: "until_next",
  };
}

// A runtime `error` event → its Panel notice. Config-missing errors
// (missing_provider / missing_mode) are actionable and stick until the next
// session; runtime/generic failures auto-dismiss. The event message becomes the
// detail line under the headline.
function errorNotice(code: VoiceRuntimeErrorCode, message: string): PanelNotice {
  switch (code) {
    case "missing_provider":
      return {
        id: "error:missing_provider",
        type: "permission",
        message: "No transcription provider",
        detail: message,
        durationMs: 0,
        dismissPolicy: "until_next",
      };
    case "missing_mode":
      return {
        id: "error:missing_mode",
        type: "error",
        message: "No active mode",
        detail: message,
        durationMs: 0,
        dismissPolicy: "until_next",
      };
    case "runtime_unavailable":
      return {
        id: "error:runtime_unavailable",
        type: "error",
        message: "Voice runtime unavailable",
        detail: message,
        durationMs: PANEL_ERROR_DURATION_MS,
        dismissPolicy: "auto",
      };
    case "generic":
      return {
        id: "error:generic",
        type: "error",
        message: "Something went wrong",
        detail: message,
        durationMs: PANEL_ERROR_DURATION_MS,
        dismissPolicy: "auto",
      };
  }
}

/**
 * The Panel notice implied by a terminal (completed/cancelled/failed) event, or
 * a `clear`/`null` action when the outcome needs no Panel. Surfaces exactly the
 * notifications that used to be crammed into the capsule: empty results, the
 * focus-changed / clipboard-fallback hint, and failures.
 */
function terminalAction(
  event: Extract<VoiceRuntimeEvent, { kind: "completed" | "cancelled" | "failed" }>,
): PanelAction {
  if (event.kind === "cancelled") {
    // A user-initiated abort is quiet — just hide any prior notice.
    return { kind: "clear" };
  }

  if (event.kind === "failed") {
    return {
      kind: "push",
      notice: {
        id: "session:failed",
        type: "error",
        message: "Dictation failed",
        ...(event.final_text.length > 0 ? { detail: event.final_text } : {}),
        durationMs: PANEL_ERROR_DURATION_MS,
        dismissPolicy: "auto",
      },
    };
  }

  // completed: surface only the cases that need words; a clean insert is silent.
  if (event.empty_reason !== undefined) {
    return { kind: "push", notice: emptyReasonNotice(event.empty_reason) };
  }

  const outcome = event.injection_outcome;
  if (outcome.kind === "focus_lost") {
    return {
      kind: "push",
      notice: {
        id: "session:focus-lost",
        type: "info",
        message: `Focus moved to ${outcome.detail.actual_app_name}`,
        detail: event.final_text,
        primaryAction: { id: "copy_text", label: "Copy" },
        durationMs: PANEL_ERROR_DURATION_MS,
        dismissPolicy: "auto",
      },
    };
  }
  if (outcome.kind === "manual_copy_required") {
    if (outcome.reason === "clipboard_unrestorable") {
      return {
        kind: "push",
        notice: {
          id: "session:clipboard-unrestorable",
          type: "info",
          message: "Clipboard left unchanged",
          detail: event.final_text,
          primaryAction: { id: "copy_text", label: "Copy" },
          durationMs: PANEL_DEFAULT_DURATION_MS,
          dismissPolicy: "auto",
        },
      };
    }
    if (outcome.reason === "native_unavailable") {
      return {
        kind: "push",
        notice: {
          id: "session:native-unavailable",
          type: "info",
          message: "Text insertion unavailable",
          detail: event.final_text,
          primaryAction: { id: "copy_text", label: "Copy" },
          durationMs: PANEL_DEFAULT_DURATION_MS,
          dismissPolicy: "auto",
        },
      };
    }
    return {
      kind: "push",
      notice: {
        id: "session:manual-fallback",
        type: "info",
        message: "Couldn't confirm the insert",
        detail: event.final_text,
        primaryAction: { id: "copy_text", label: "Copy" },
        durationMs: PANEL_DEFAULT_DURATION_MS,
        dismissPolicy: "auto",
      },
    };
  }
  if (outcome.kind === "failed") {
    return {
      kind: "push",
      notice: {
        id: "session:inject-failed",
        type: "error",
        message: "Could not insert text",
        detail: outcome.detail,
        durationMs: PANEL_ERROR_DURATION_MS,
        dismissPolicy: "auto",
      },
    };
  }

  // paste_sent / no_op with text -> success, no Panel needed.
  return { kind: "clear" };
}

export function panelActionForVoiceEvent(event: VoiceRuntimeEvent): PanelAction | null {
  switch (event.kind) {
    case "started":
      // A fresh session must never inherit the previous run's notice.
      return { kind: "clear" };

    case "error":
      return { kind: "push", notice: errorNotice(event.code, event.message) };

    case "slow":
      return { kind: "push", notice: slowNotice(event.mode_id, event.elapsed_ms) };

    case "completed":
    case "cancelled":
    case "failed":
      return terminalAction(event);

    // thinking / inserting / level only move the capsule.
    case "thinking":
    case "inserting":
    case "level":
      return null;
  }
}

/** Auto-dismiss delay for a notice, or null when the host should not schedule one. */
export function panelAutoDismissDelayMs(notice: PanelNotice): number | null {
  if (notice.dismissPolicy !== "auto") return null;
  return Number.isFinite(notice.durationMs) && notice.durationMs > 0 ? notice.durationMs : null;
}

/**
 * How long the capsule WINDOW should stay visible after a terminal event so the
 * Panel notice it implies is actually readable. The Panel lives inside the
 * capsule window, so the window's hide delay must cover the notice — otherwise a
 * default ~350ms hide whisks the Panel away before it can be read.
 *
 * Returns:
 *  - the notice's duration (auto-dismiss notices: error/info/empty/…),
 *  - STICKY_NOTICE_LINGER_MS for sticky (until_next, duration 0) notices,
 *  - null when the event implies NO notice (clean success / cancel) — the caller
 *    then uses its default short hide so the pill disappears promptly.
 */
export function panelHideLingerMs(event: VoiceRuntimeEvent): number | null {
  const action = panelActionForVoiceEvent(event);
  if (action === null || action.kind !== "push") return null;
  return (panelAutoDismissDelayMs(action.notice) ?? STICKY_NOTICE_LINGER_MS) + PANEL_EXIT_MARGIN_MS;
}
