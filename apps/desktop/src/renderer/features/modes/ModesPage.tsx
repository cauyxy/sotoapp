// ModesPage — React/Electron restoration of the old
// apps/desktop/src/features/modes/ModesPage.svelte (Phase 2B).
//
// Ports the mode list + selected-mode editor (name, prompt body via
// PromptEditor, hotkey via header KeyCombo with live key-combo capture),
// debounced autosave (modesAutosave) calling save_mode, and disjoint-chord
// validation. Svelte 5 runes → React hooks:
//   $state            → useState
//   non-reactive `let` → useRef
//   $derived          → useMemo
//   $effect           → useEffect
//   modesStore (Svelte store) → page-local `modes` state, hydrated once from the
//     AppModel then owned by the page (saves go through save_mode and the model
//     refresh keeps other surfaces in sync).
//
// The editor model (mode list + selected id + working draft + last-persisted
// keys), the two debounced autosaves and the save IO all live in a framework-
// free mode-editor controller (modes/modeEditorController.ts) — extracted so the
// page no longer mirrors state into refs nor carries two near-duplicate save
// functions (audit: modes-page-ref-mirroring-orchestration). This component
// holds only what it renders, syncing the controller snapshot via
// useSyncExternalStore, plus the two UI-presentation flags below.
//
// `isActive` (old prop driving flush-on-deactivate) is derived from the app
// store's current view, since App.tsx renders <ModesPage/> with no props and
// toggles panes via [hidden].

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { PageHeader } from "../../shared/ui/primitives/PageHeader";
import { SignalDot } from "../../shared/ui/primitives/SignalDot";
import { prettyChord } from "../../shared/chordDisplay";
import { useT } from "../../i18n/context";
import { confirmDialog, rendererOs } from "../../ipc";
import { useAppStore } from "../../store/appStore";
import { useAppModel, useAppResources } from "../../store/appResources";

import { canonicalModeLabel } from "../../shared/canonicalModes";
import { PromptEditor } from "./editor/PromptEditor";
import { KeyCombo } from "./editor/KeyCombo";
import { BindingModal } from "./editor/BindingModal";
import { createModeEditorController } from "./editor/modeEditorController";
import { modeIdentityTag } from "./modesView";

type PromptStatus = "empty" | "ready";

function domSafeId(prefix: string, id: string): string {
  return `${prefix}-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

export function ModesPage(): JSX.Element {
  const t = useT();
  const isActive = useAppStore((s) => s.view === "Modes");
  const resources = useAppResources();
  const appModel = useAppModel();

  // Framework-free editor model + autosave + save IO. Created once; the page
  // pushes the live translator in so toasts/labels track a locale change (the
  // old build read the module-level `translate`, which was always live).
  // onSaved refreshes the AppModel so Home readiness + the model's mode list
  // reflect a hotkey/prompt/command edit (plan §4.10).
  const controllerRef = useRef<ReturnType<typeof createModeEditorController>>();
  if (!controllerRef.current) {
    controllerRef.current = createModeEditorController({
      t,
      onSaved: () => {
        void resources.refresh("modes");
      },
    });
  }
  const controller = controllerRef.current;
  controller.setTranslator(t);

  // Render-facing snapshot of the editor model (modes / selectedModeId /
  // modeDraft). useSyncExternalStore keeps it in lockstep with the controller.
  const { modes, selectedModeId, modeDraft } = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );

  // UI-presentation flags that stay in React: promptStatus gates the prompt-body
  // autosave; editingHotkeyModeId renders the modal that owns capture and commit.
  const [promptStatus, setPromptStatus] = useState<PromptStatus>("empty");
  const [editingHotkeyModeId, setEditingHotkeyModeId] = useState<string | null>(null);
  const hotkeyButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const nameInputRefs = useRef(new Map<string, HTMLInputElement>());
  const lastEditingHotkeyModeIdRef = useRef<string | null>(null);
  const [focusNameModeId, setFocusNameModeId] = useState<string | null>(null);

  // The AppModel's modes seed the editor list once; thereafter the controller
  // owns it. (Save success → AppResources.refresh("modes") lands in Phase 4 / §4.10.)
  const seedModes = useMemo(
    () => appModel?.modes,
    [appModel?.modes],
  );
  const hydratedFromSeed = useRef(false);
  useEffect(() => {
    if (!hydratedFromSeed.current && seedModes !== undefined) {
      hydratedFromSeed.current = true;
      controller.hydrateModes(seedModes);
    }
  }, [controller, seedModes]);

  // Schedule mode-metadata autosave whenever the draft changes.
  useEffect(() => {
    controller.scheduleModeAutosave();
    return () => controller.clearModeAutosave();
  }, [controller, modeDraft]);

  // Schedule prompt-body autosave whenever the draft changes (once ready).
  useEffect(() => {
    if (promptStatus !== "ready") return;
    controller.schedulePromptAutosave();
    return () => controller.clearPromptAutosave();
  }, [controller, modeDraft, promptStatus]);

  // On deactivate (navigating away from Modes), stop capture + flush pending.
  useEffect(() => {
    if (!isActive) {
      setEditingHotkeyModeId(null);
      void controller.flushAll();
    }
  }, [controller, isActive]);

  // Flush on unmount.
  useEffect(() => {
    return () => {
      void controller.flushAll();
    };
  }, [controller]);

  async function toggleModeById(modeId: string): Promise<void> {
    const result = await controller.toggleModeById(modeId);
    if (result === "expanded") {
      setPromptStatus("ready");
    }
    if (result !== "unchanged") setEditingHotkeyModeId(null);
  }

  async function onCreateMode(): Promise<void> {
    const modeId = await controller.createMode();
    if (modeId === null) return;
    setPromptStatus("ready");
    setFocusNameModeId(modeId);
  }

  async function onDeleteMode(mode: typeof modes[number]): Promise<void> {
    const draftName = modeDraft?.id === mode.id ? modeDraft.name : mode.name;
    const name = canonicalModeLabel(t, mode.id) ?? draftName;
    const ok = await confirmDialog({
      message: t("modes.deleteModeConfirm", { name }),
      detail: t("modes.deleteModeConfirmBody"),
      confirmLabel: t("modes.deleteModeConfirmOk"),
      cancelLabel: t("modes.deleteModeConfirmCancel"),
    });
    if (!ok) return;
    await controller.deleteMode(mode.id);
  }

  function closeHotkeyEditor(): void {
    setEditingHotkeyModeId(null);
  }

  useEffect(() => {
    if (focusNameModeId === null) return;
    const input = nameInputRefs.current.get(focusNameModeId);
    if (!input) return;
    input.focus();
    input.select();
    setFocusNameModeId(null);
  }, [focusNameModeId, modeDraft]);

  useEffect(() => {
    const previous = lastEditingHotkeyModeIdRef.current;
    if (previous !== null && editingHotkeyModeId === null) {
      hotkeyButtonRefs.current.get(previous)?.focus();
    }
    lastEditingHotkeyModeIdRef.current = editingHotkeyModeId;
  }, [editingHotkeyModeId]);

  const editingHotkeyTarget = useMemo(() => {
    if (editingHotkeyModeId === null) return null;
    const mode = modes.find((candidate) => candidate.id === editingHotkeyModeId);
    if (!mode) return null;
    const draftChord =
      modeDraft?.id === mode.id && modeDraft.hotkey_enabled
        ? modeDraft.hotkey_chord
        : null;
    return {
      id: mode.id,
      name: canonicalModeLabel(t, mode.id) ?? mode.name,
      chord: draftChord ?? mode.hotkey?.chord ?? "",
    };
  }, [editingHotkeyModeId, modeDraft, modes, t]);

  return (
    <section className="page modes-page">
      <PageHeader title={t("modes.title")} />
      <div className="modes-card-stack" role="list" aria-label={t("modes.voiceTab")}>
        {modes.map((mode) => {
          const expanded = mode.id === selectedModeId && modeDraft?.id === mode.id;
          const bodyId = domSafeId("voice-mode-body", mode.id);
          const label = canonicalModeLabel(t, mode.id) ?? mode.name;
          const chord = mode.hotkey?.chord ?? "";
          const shortcutAria = chord
            ? t("modes.shortcutButtonBoundAria", {
                name: label,
                chord: prettyChord(chord, rendererOs()),
              })
            : t("modes.shortcutButtonAria", { name: label });
          const identity = modeIdentityTag(mode);
          return (
            <div
              key={mode.id}
              className={`mode-card${expanded ? " is-expanded" : ""}`}
              role="listitem"
            >
              <div className="mode-card-toggle voice-card-head">
                <button
                  type="button"
                  className="mode-card-main-button"
                  aria-expanded={expanded}
                  aria-controls={bodyId}
                  onClick={() => void toggleModeById(mode.id)}
                >
                  <span className="mode-card-identity" data-tone={identity.tone}>
                    <SignalDot tone={identity.tone} />
                    <span>{t(identity.labelKey)}</span>
                  </span>
                  <span className="mode-card-title" title={label}>{label}</span>
                </button>
                <button
                  ref={(node) => {
                    if (node) hotkeyButtonRefs.current.set(mode.id, node);
                    else hotkeyButtonRefs.current.delete(mode.id);
                  }}
                  type="button"
                  className="mode-card-hotkey-button"
                  aria-label={shortcutAria}
                  title={shortcutAria}
                  onClick={() => setEditingHotkeyModeId(mode.id)}
                >
                  {chord ? (
                    <KeyCombo chord={chord} />
                  ) : (
                    <span className="mode-card-hotkey-empty">{t("modes.shortcutSet")}</span>
                  )}
                </button>
              </div>

              {expanded && modeDraft ? (
                <div id={bodyId} className="mode-card-body">
                  {!mode.built_in ? (
                    <label className="mode-card-name-field">
                      <span>{t("modes.nameLabel")}</span>
                      <input
                        ref={(node) => {
                          if (node) nameInputRefs.current.set(mode.id, node);
                          else nameInputRefs.current.delete(mode.id);
                        }}
                        type="text"
                        value={modeDraft.name}
                        aria-label={t("modes.nameLabel")}
                        placeholder={t("modes.namePlaceholder")}
                        onChange={(event) => controller.updateName(event.target.value)}
                      />
                    </label>
                  ) : null}
                  <PromptEditor
                    value={modeDraft.prompt_body}
                    status={promptStatus}
                    onChange={(next) => controller.updatePromptBody(next)}
                  />
                  {!mode.built_in ? (
                    <div className="mode-card-actions">
                      <button
                        type="button"
                        className="mode-card-delete"
                        onClick={() => void onDeleteMode(mode)}
                      >
                        {t("modes.deleteMode")}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
        <div className="mode-card-add-item" role="listitem">
          <button
            type="button"
            className="mode-card-add"
            onClick={() => void onCreateMode()}
          >
            <span className="mode-card-add-plus" aria-hidden="true">+</span>
            <span>{t("modes.newModeButton")}</span>
          </button>
        </div>
      </div>
      {editingHotkeyTarget ? (
        <BindingModal
          key={editingHotkeyTarget.id}
          target={editingHotkeyTarget}
          modes={modes}
          controller={controller}
          onClose={closeHotkeyEditor}
        />
      ) : null}
    </section>
  );
}
