import { describe, expect, it } from "vitest";

import {
  initialPanelState,
  panelAutoDismissDelayMs,
  panelActionForVoiceEvent,
  panelHideLingerMs,
  panelReducer,
  PANEL_DEFAULT_DURATION_MS,
  PANEL_ERROR_DURATION_MS,
  PANEL_EXIT_MARGIN_MS,
  STICKY_NOTICE_LINGER_MS,
  type PanelNotice,
  type PanelState,
} from "./panelState.js";
import type { VoiceRuntimeEvent } from "../../contract/events.js";

const notice = (over: Partial<PanelNotice> = {}): PanelNotice => ({
  id: "n1",
  type: "info",
  message: "Hello",
  durationMs: 4000,
  dismissPolicy: "auto",
  ...over,
});

describe("panelReducer", () => {
  it("starts hidden", () => {
    expect(initialPanelState).toEqual({ notice: null, seq: 0 });
  });

  it("push shows a notice and bumps seq", () => {
    const next = panelReducer(initialPanelState, { kind: "push", notice: notice() });
    expect(next.notice?.message).toBe("Hello");
    expect(next.seq).toBe(1);
  });

  it("push replaces the current notice (latest wins) without losing seq monotonicity", () => {
    const a = panelReducer(initialPanelState, { kind: "push", notice: notice({ id: "a", message: "A" }) });
    const b = panelReducer(a, { kind: "push", notice: notice({ id: "b", message: "B" }) });
    expect(b.notice?.id).toBe("b");
    expect(b.seq).toBe(2);
  });

  it("dismiss by matching id clears the notice", () => {
    const a = panelReducer(initialPanelState, { kind: "push", notice: notice({ id: "a" }) });
    const cleared = panelReducer(a, { kind: "dismiss", id: "a" });
    expect(cleared.notice).toBeNull();
    expect(cleared.seq).toBe(2);
  });

  it("a stale dismiss (id no longer current) is a no-op and keeps the reference", () => {
    const a = panelReducer(initialPanelState, { kind: "push", notice: notice({ id: "a" }) });
    const b = panelReducer(a, { kind: "push", notice: notice({ id: "b" }) });
    const staleDismiss = panelReducer(b, { kind: "dismiss", id: "a" });
    expect(staleDismiss).toBe(b); // unchanged reference → no garbling of the live notice
    expect(staleDismiss.notice?.id).toBe("b");
  });

  it("clear hides the panel; clearing an empty panel is a no-op reference", () => {
    const a = panelReducer(initialPanelState, { kind: "push", notice: notice() });
    const cleared = panelReducer(a, { kind: "clear" });
    expect(cleared.notice).toBeNull();
    const again = panelReducer(cleared, { kind: "clear" });
    expect(again).toBe(cleared);
  });

  it("is pure: does not mutate input", () => {
    const frozen: PanelState = Object.freeze({ ...initialPanelState });
    expect(() => panelReducer(frozen, { kind: "push", notice: notice() })).not.toThrow();
    expect(frozen.notice).toBeNull();
  });
});

describe("panelActionForVoiceEvent", () => {
  it("started clears stale notices (capsule state change must not leave panel residue)", () => {
    const action = panelActionForVoiceEvent({
      kind: "started",
      handle_id: "h",
      mode_id: "m",
      status: "listening",
      mode_name: null,
    });
    expect(action).toEqual({ kind: "clear" });
  });

  it("thinking / inserting / level do not touch the panel", () => {
    expect(
      panelActionForVoiceEvent({
        kind: "thinking",
        handle_id: "h",
        mode_id: "m",
        status: "thinking",
        mode_name: null,
      }),
    ).toBeNull();
    expect(
      panelActionForVoiceEvent({
        kind: "inserting",
        handle_id: "h",
        mode_id: "m",
        status: "inserting",
        mode_name: null,
      }),
    ).toBeNull();
    expect(panelActionForVoiceEvent({ kind: "level", rms: 10, peak: 20 })).toBeNull();
  });

  it("generic error → auto-dismissing error notice carrying the message as detail", () => {
    const action = panelActionForVoiceEvent({ kind: "error", code: "generic", message: "boom" });
    expect(action?.kind).toBe("push");
    if (action?.kind !== "push") throw new Error("expected push");
    expect(action.notice.type).toBe("error");
    expect(action.notice.detail).toBe("boom");
    expect(action.notice.dismissPolicy).toBe("auto");
    expect(action.notice.durationMs).toBe(PANEL_ERROR_DURATION_MS);
  });

  it("missing_provider → sticky permission notice (until_next, no auto-dismiss)", () => {
    const action = panelActionForVoiceEvent({
      kind: "error",
      code: "missing_provider",
      message: "add one",
    });
    if (action?.kind !== "push") throw new Error("expected push");
    expect(action.notice.type).toBe("permission");
    expect(action.notice.dismissPolicy).toBe("until_next");
    expect(action.notice.durationMs).toBe(0);
  });

  it("missing_mode → sticky error notice (actionable config, until_next)", () => {
    const action = panelActionForVoiceEvent({
      kind: "error",
      code: "missing_mode",
      message: "pick a mode",
    });
    if (action?.kind !== "push") throw new Error("expected push");
    expect(action.notice.id).toBe("error:missing_mode");
    expect(action.notice.type).toBe("error");
    expect(action.notice.dismissPolicy).toBe("until_next");
    expect(action.notice.durationMs).toBe(0);
    expect(action.notice.detail).toBe("pick a mode");
  });

  it("runtime_unavailable → auto-dismissing error notice", () => {
    const action = panelActionForVoiceEvent({
      kind: "error",
      code: "runtime_unavailable",
      message: "voice runtime not ready",
    });
    if (action?.kind !== "push") throw new Error("expected push");
    expect(action.notice.id).toBe("error:runtime_unavailable");
    expect(action.notice.type).toBe("error");
    expect(action.notice.dismissPolicy).toBe("auto");
    expect(action.notice.durationMs).toBe(PANEL_ERROR_DURATION_MS);
  });

  it("completed with empty_reason → info notice instead of silent capsule", () => {
    const event: VoiceRuntimeEvent = {
      kind: "completed",
      history_id: "h",
      raw_text: "",
      processed_text: null,
      final_text: "",
      status: "empty",
      injection_outcome: { kind: "no_op" },
      empty_reason: "silent",
    };
    const action = panelActionForVoiceEvent(event);
    if (action?.kind !== "push") throw new Error("expected push");
    expect(action.notice.type).toBe("info");
    expect(action.notice.detail).toContain("No speech");
  });

  it("completed with focus_lost → copied notice carrying the final text", () => {
    const event: VoiceRuntimeEvent = {
      kind: "completed",
      history_id: "h",
      raw_text: "hi",
      processed_text: "hi",
      final_text: "hi",
      status: "completed",
      injection_outcome: {
        kind: "focus_lost",
        detail: { saved_app_name: "Notes", actual_app_name: "Safari" },
      },
    };
    const action = panelActionForVoiceEvent(event);
    if (action?.kind !== "push") throw new Error("expected push");
    expect(action.notice.message).toBe("Focus moved to Safari");
    expect(action.notice.detail).toBe("hi");
    expect(action.notice.primaryAction).toEqual({ id: "copy_text", label: "Copy" });
  });

  it("completed with unrestorable clipboard manual fallback → explicit copy action", () => {
    const event: VoiceRuntimeEvent = {
      kind: "completed",
      history_id: "h",
      raw_text: "hi",
      processed_text: null,
      final_text: "hi",
      status: "completed",
      injection_outcome: { kind: "manual_copy_required", reason: "clipboard_unrestorable" },
    };
    const action = panelActionForVoiceEvent(event);
    if (action?.kind !== "push") throw new Error("expected push");
    expect(action.notice.message).toBe("Clipboard left unchanged");
    expect(action.notice.detail).toBe("hi");
    expect(action.notice.primaryAction).toEqual({ id: "copy_text", label: "Copy" });
  });

  it("completed with native-unavailable manual fallback -> dedicated copy notice", () => {
    const event: VoiceRuntimeEvent = {
      kind: "completed",
      history_id: "h",
      raw_text: "hi",
      processed_text: null,
      final_text: "hi",
      status: "completed",
      injection_outcome: { kind: "manual_copy_required", reason: "native_unavailable" },
    };
    const action = panelActionForVoiceEvent(event);
    if (action?.kind !== "push") throw new Error("expected push");
    expect(action.notice.id).toBe("session:native-unavailable");
    expect(action.notice.message).toBe("Text insertion unavailable");
    expect(action.notice.detail).toBe("hi");
    expect(action.notice.primaryAction).toEqual({ id: "copy_text", label: "Copy" });
  });

  it("clean completed insert → clear (no panel noise on success)", () => {
    const event: VoiceRuntimeEvent = {
      kind: "completed",
      history_id: "h",
      raw_text: "hi",
      processed_text: "hi",
      final_text: "hi",
      status: "completed",
      injection_outcome: { kind: "paste_sent" },
    };
    expect(panelActionForVoiceEvent(event)).toEqual({ kind: "clear" });
  });

  it("cancelled → clear (quiet abort)", () => {
    const event: VoiceRuntimeEvent = {
      kind: "cancelled",
      history_id: "",
      raw_text: "",
      processed_text: null,
      final_text: "",
      status: "cancelled",
      injection_outcome: { kind: "no_op" },
    };
    expect(panelActionForVoiceEvent(event)).toEqual({ kind: "clear" });
  });

  it("failed → error notice", () => {
    const event: VoiceRuntimeEvent = {
      kind: "failed",
      history_id: "h",
      raw_text: "x",
      processed_text: null,
      final_text: "x",
      status: "failed",
      injection_outcome: { kind: "failed", detail: "nope" },
    };
    const action = panelActionForVoiceEvent(event);
    if (action?.kind !== "push") throw new Error("expected push");
    expect(action.notice.type).toBe("error");
  });
});

describe("panelHideLingerMs (capsule window must outlive a readable notice)", () => {
  it("returns null for events with no notice (clean success / cancel) → default short hide", () => {
    const completed: VoiceRuntimeEvent = {
      kind: "completed",
      history_id: "h",
      raw_text: "hi",
      processed_text: "hi",
      final_text: "hi",
      status: "completed",
      injection_outcome: { kind: "paste_sent" },
    };
    expect(panelHideLingerMs(completed)).toBeNull();
    expect(
      panelHideLingerMs({
        kind: "thinking",
        handle_id: "h",
        mode_id: "m",
        status: "thinking",
        mode_name: null,
      }),
    ).toBeNull();
  });

  it("returns the error duration for an error so the window stays long enough to read", () => {
    expect(panelHideLingerMs({ kind: "error", code: "generic", message: "boom" })).toBe(
      PANEL_ERROR_DURATION_MS + PANEL_EXIT_MARGIN_MS,
    );
  });

  it("returns the default duration for an info notice (empty result)", () => {
    const empty: VoiceRuntimeEvent = {
      kind: "completed",
      history_id: "h",
      raw_text: "",
      processed_text: null,
      final_text: "",
      status: "empty",
      injection_outcome: { kind: "no_op" },
      empty_reason: "silent",
    };
    expect(panelHideLingerMs(empty)).toBe(PANEL_DEFAULT_DURATION_MS + PANEL_EXIT_MARGIN_MS);
  });

  it("returns the sticky linger for a sticky (until_next) notice like missing_provider", () => {
    expect(
      panelHideLingerMs({ kind: "error", code: "missing_provider", message: "add one" }),
    ).toBe(STICKY_NOTICE_LINGER_MS + PANEL_EXIT_MARGIN_MS);
  });
});

describe("slow-transcription notice", () => {
  it("maps slow to a sticky info notice", () => {
    const a = panelActionForVoiceEvent({ kind: "slow", mode_id: "default", elapsed_ms: 8000 });
    expect(a).toEqual({
      kind: "push",
      notice: {
        id: "session:slow",
        type: "info",
        message: "Still transcribing…",
        durationMs: 0,
        dismissPolicy: "until_next",
      },
    });
  });

  it("uses the translating message for the translate mode", () => {
    const a = panelActionForVoiceEvent({ kind: "slow", mode_id: "translate", elapsed_ms: 8000 });
    expect(a?.kind === "push" && a.notice.message).toBe("Still translating…");
  });

  it("adds the Esc hint at 20s", () => {
    const a = panelActionForVoiceEvent({ kind: "slow", mode_id: "default", elapsed_ms: 20000 });
    expect(a?.kind === "push" && a.notice.detail).toBe("Press Esc to cancel.");
  });
});

describe("panelHideLingerMs exit margin", () => {
  it("adds PANEL_EXIT_MARGIN_MS so the renderer owns the dismissal beat", () => {
    const failed: VoiceRuntimeEvent = {
      kind: "failed",
      history_id: "h",
      raw_text: "",
      processed_text: null,
      final_text: "",
      status: "failed",
      injection_outcome: { kind: "no_op" },
    };
    expect(panelHideLingerMs(failed)).toBe(PANEL_ERROR_DURATION_MS + PANEL_EXIT_MARGIN_MS);
  });
});

describe("panelAutoDismissDelayMs", () => {
  it("returns the notice duration only for finite positive auto-dismiss notices", () => {
    expect(panelAutoDismissDelayMs(notice({ durationMs: 2500, dismissPolicy: "auto" }))).toBe(
      2500,
    );
    expect(panelAutoDismissDelayMs(notice({ durationMs: 0, dismissPolicy: "auto" }))).toBeNull();
    expect(
      panelAutoDismissDelayMs(
        notice({ durationMs: Number.POSITIVE_INFINITY, dismissPolicy: "auto" }),
      ),
    ).toBeNull();
  });

  it("returns null for sticky or manual notices", () => {
    expect(
      panelAutoDismissDelayMs(notice({ durationMs: 2500, dismissPolicy: "until_next" })),
    ).toBeNull();
    expect(panelAutoDismissDelayMs(notice({ durationMs: 2500, dismissPolicy: "manual" }))).toBeNull();
  });
});
