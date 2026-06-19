import type { PanelNotice } from "@soto/core";

import { useT } from "../../i18n/context";
import "./capsulePanel.css";

// The Panel: the notification surface stacked ABOVE the capsule pill. It is
// purely presentational — given the current notice (or null) it draws a strip
// (no detail: one-line 999px capsule, click anywhere dismisses) or a card
// (detail: column card with one centered button — the notice's primary action
// when it has one, which both acts AND dismisses; otherwise a plain "got it"
// dismiss). All lifecycle (what to
// show, when to auto-dismiss, clearing on a new session) lives in the pure
// panelReducer + the capsule hook. The PANEL ROOT — not just the button —
// intercepts pointer events: hovering it asks main to make the click-through
// window momentarily interactive, and leaving returns it to click-through.
export interface CapsulePanelProps {
  notice: PanelNotice | null;
  exiting: boolean;
  /** Dismiss the current notice. */
  onDismiss: () => void;
  onPrimaryAction?: (id: "copy_text" | "open_permission_settings") => void;
  /**
   * Toggle overlay interactivity: true on panel hover-enter, false on leave.
   * The window overlay is click-through by default, so the panel intercepts
   * mouse events to make the window momentarily interactive.
   */
  onHoverChange: (interactive: boolean) => void;
}

export function CapsulePanel({
  notice,
  exiting,
  onDismiss,
  onPrimaryAction,
  onHoverChange,
}: CapsulePanelProps): JSX.Element | null {
  const t = useT();

  if (notice === null) return null;

  const detail = notice.detail ?? "";
  const hasDetail = detail.length > 0;

  // Deliberately NOT onHoverChange(false): a user dismissal must not route
  // through the hover-leave path (whose resume floor re-arms ~1.5s+ of window
  // linger). onDismiss reports the dismissal to main, which expedites the
  // window hide and re-asserts click-through itself.
  const dismiss = (): void => {
    onDismiss();
  };
  const primaryAction = notice.primaryAction;

  // The strip is a clickable div without button semantics. Acceptable here:
  // this overlay window is non-activating and never keyboard-focusable by
  // design (showInactive + click-through), so there is no keyboard path to
  // mis-serve — the aria-live region still announces the message itself.
  return (
    <div
      className={`capsule-panel capsule-panel-${notice.type}${exiting ? " capsule-panel-exiting" : ""}`}
      data-has-detail={hasDetail ? "true" : "false"}
      role="status"
      aria-live="polite"
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      onClick={hasDetail ? undefined : dismiss}
    >
      <div className="capsule-panel-row">
        <span aria-hidden className="capsule-panel-dot" />
        <div className="capsule-panel-text">
          <div className="capsule-panel-message">{notice.message}</div>
          {hasDetail ? (
            <div className="capsule-panel-detail">{detail}</div>
          ) : null}
        </div>
      </div>
      {hasDetail ? (
        <div className="capsule-panel-actions">
          {primaryAction ? (
            // The primary action doubles as the dismiss: running it (copy /
            // open settings) is the user's "done" gesture, so it also collapses
            // the Panel. No separate "got it" button when an action is present.
            <button
              type="button"
              className="capsule-panel-primary"
              onClick={() => {
                onPrimaryAction?.(primaryAction.id);
                dismiss();
              }}
            >
              {primaryAction.label}
            </button>
          ) : (
            // No action to take — the only affordance is to acknowledge/close.
            <button type="button" className="capsule-panel-dismiss" onClick={dismiss}>
              {t("capsule.gotIt")}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
