import { useCallback, useId, useMemo, useRef, useState } from "react";
import { serializeChord, type Chord } from "@soto/core";

import { canonicalModeLabel } from "../../../shared/canonicalModes";
import { CloseIcon, IconButton } from "../../../shared/ui/primitives/IconButton";
import { useT } from "../../../i18n/context";
import { rendererOs } from "../../../ipc";
import { KeyCombo } from "./KeyCombo";
import { useCaptureDialog } from "./captureDialog";
import {
  validateChordDisjoint,
  type ChordDisjointConflict,
} from "./modes.draft";
import { type ModeEditorController } from "./modeEditorController";
import { type ModeRecord, type HotkeyConflictPolicy } from "./modes.ipc";
import { prettyChord } from "./modifierDisplay";

interface BindingModalProps {
  target: {
    id: string;
    name: string;
    chord: string;
  };
  modes: readonly ModeRecord[];
  controller: ModeEditorController;
  onClose: () => void;
}

function WarningIcon(): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 2.5 14 13H2L8 2.5Z" />
      <path d="M8 6v3" />
      <path d="M8 11.5h.01" />
    </svg>
  );
}

function otherChordsForMode(
  t: ReturnType<typeof useT>,
  modes: readonly ModeRecord[],
  target: { id: string },
): Array<{ id: string; name: string; chord: string }> {
  return modes.flatMap((mode) =>
    mode.id !== target.id && mode.hotkey
      ? [{
          id: mode.id,
          name: canonicalModeLabel(t, mode.id) || mode.name,
          chord: mode.hotkey.chord,
        }]
      : [],
  );
}

function findConflict(
  chord: string | null,
  t: ReturnType<typeof useT>,
  modes: readonly ModeRecord[],
  target: { id: string },
): ChordDisjointConflict | null {
  if (!chord) return null;
  return validateChordDisjoint(chord, otherChordsForMode(t, modes, target));
}

export function BindingModal({
  target,
  modes,
  controller,
  onClose,
}: BindingModalProps): JSX.Element {
  const t = useT();
  const titleId = useId();
  const initialChord = target.chord || undefined;
  const hadInitialChord = useRef(initialChord !== undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conflictRef = useRef<ChordDisjointConflict | null>(null);

  const commitCurrent = useCallback(
    async (
      policy: HotkeyConflictPolicy,
      chord: Chord | null,
      closeDialog: () => void,
    ) => {
      if (!chord || saving) return;
      setSaving(true);
      setError(null);
      try {
        await controller.commitHotkeyFor(target.id, chord, policy);
        closeDialog();
      } catch {
        setError(t("modes.modeSaveError"));
      } finally {
        setSaving(false);
      }
    },
    [controller, saving, t, target.id],
  );

  const handleCaptureCommit = useCallback(
    (chord: Chord, { close }: { close: () => void }) => {
      if (conflictRef.current === null) void commitCurrent("reject", chord, close);
    },
    [commitCurrent],
  );

  const {
    snapshot,
    visibleHint,
    suppressing,
    modalRef,
    footRef,
    close,
    rerecord: resetCapture,
    onScrimMouseDown,
    onDialogKeyDown,
  } = useCaptureDialog({
    initialChord,
    onClose,
    onCommit: handleCaptureCommit,
  });

  const conflict = useMemo(
    () => findConflict(snapshot.chord, t, modes, target),
    [modes, snapshot.chord, t, target],
  );
  conflictRef.current = conflict;

  const modeName = target.name;
  const hintText =
    visibleHint === "onlyModifiers"
      ? t("modes.shortcutOnlyModifiers")
      : visibleHint === "maxTwo"
        ? t("modes.shortcutMaxTwo")
        : snapshot.phase === "holding"
          ? t("modes.shortcutReleaseHint")
          : snapshot.phase === "captured"
            ? t("modes.shortcutToggleHint")
            : suppressing
              ? t("modes.shortcutSuppressNote")
              : t("modes.shortcutEscHint");

  async function clearHotkey(): Promise<void> {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await controller.clearHotkeyFor(target.id);
      close();
    } catch {
      setError(t("modes.modeSaveError"));
    } finally {
      setSaving(false);
    }
  }

  function rerecord(): void {
    resetCapture();
    setError(null);
  }

  const hasChord = snapshot.phase === "captured" && snapshot.chord !== null;
  const shared =
    conflict && conflict.sharedModifiers.length > 0
      ? prettyChord(serializeChord(conflict.sharedModifiers))
      : "";
  const titleText = `「${modeName}」· ${t("modes.shortcut")}`;
  const replaceLabel = conflict
    ? t("modes.shortcutReplace", { name: conflict.conflictingModeName })
    : "";

  return (
    <div className="binding-scrim" onMouseDown={onScrimMouseDown}>
      <div
        ref={modalRef}
        className="binding-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onDialogKeyDown}
      >
        <div className="binding-modal-head">
          <div id={titleId} className="binding-modal-title" title={titleText}>
            {titleText}
          </div>
          <IconButton
            icon={<CloseIcon />}
            label={t("common.close")}
            className="binding-modal-close"
            onClick={close}
          />
        </div>

        <div className="binding-modal-stage" aria-live="polite">
          {snapshot.phase === "listening" ? (
            <>
              <span className="binding-modal-dot" aria-hidden="true" />
              <div className="binding-modal-prompt">{t("modes.shortcutPrompt")}</div>
            </>
          ) : snapshot.chord ? (
            <>
              <KeyCombo chord={snapshot.chord} size="lg" />
              {conflict ? (
                <div className="binding-modal-conflict">
                  <WarningIcon />
                  <span className="binding-modal-conflict-text">
                    {t("modes.hotkeyConflict", {
                      name: conflict.conflictingModeName,
                      modifiers: shared,
                    })}
                  </span>
                </div>
              ) : (
                <div className="binding-modal-name">
                  {prettyChord(snapshot.chord, rendererOs())}
                </div>
              )}
            </>
          ) : null}

          {snapshot.typingWarning && !conflict && hasChord ? (
            <div className="binding-modal-warn">
              <WarningIcon />
              <span className="binding-modal-conflict-text">
                {t("modes.shortcutTypingWarn")}
              </span>
            </div>
          ) : null}
          {error ? <div className="binding-modal-error">{error}</div> : null}
          <div className="binding-modal-hint">{hintText}</div>
        </div>

        <div
          ref={footRef}
          className="binding-modal-foot"
          data-align={hasChord ? "end" : "center"}
        >
          {hasChord ? (
            <>
              {hadInitialChord.current ? (
                <button
                  type="button"
                  className="button button-link"
                  disabled={saving}
                  onClick={() => void clearHotkey()}
                >
                  {t("modes.shortcutRemove")}
                </button>
              ) : null}
              <button
                type="button"
                className="button button-ghost"
                disabled={saving}
                onClick={rerecord}
              >
                {t("modes.shortcutRerecord")}
              </button>
              {conflict ? (
                <button
                  type="button"
                  className="button button-warn"
                  disabled={saving}
                  title={replaceLabel}
                  onClick={() => void commitCurrent("steal", snapshot.chord, close)}
                >
                  <span className="binding-modal-button-text">{replaceLabel}</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="button button-primary"
                  disabled={saving}
                  onClick={() => void commitCurrent("reject", snapshot.chord, close)}
                >
                  {t("modes.shortcutConfirm")}
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              className="button button-ghost"
              disabled={saving}
              onClick={close}
            >
              {t("modes.shortcutCancel")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
