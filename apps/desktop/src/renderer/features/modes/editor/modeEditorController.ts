// Framework-free mode-editor controller — extracted from ModesPage.tsx
// (audit: modes-page-ref-mirroring-orchestration).
//
// Why this exists: the React page used to mirror `modes` / `modeDraft` /
// `selectedModeId` / the translator into refs on every render so its
// once-created save + autosave closures read fresh values rather than a stale
// capture, and it carried two near-duplicate save functions plus two inline
// autosave controllers. All of that non-render state and IO orchestration lives
// here instead. The controller owns the editor model (mode list + selected id +
// working draft + last-persisted keys), runs the two debounced autosaves, and
// exposes imperative methods + a `subscribe` snapshot. React holds only what it
// renders, syncing the model snapshot via useSyncExternalStore.
//
// Behaviour intentionally keeps the old persisted-key gating and post-save
// draft-replacement guard, but hotkey conflict ownership moved to the explicit
// binding modal: autosave uses "reject", and only commitHotkey can send "steal".

import { type Translator } from "../../../i18n";
import {
  createMode as defaultCreateMode,
  deleteMode as defaultDeleteMode,
} from "../../../ipc";
import { toast as defaultToast } from "../../../shared/ui/feedback/toast";

import {
  createAutosaveController,
  type AutosaveController,
} from "./modesAutosave";
import {
  type HotkeyConflictPolicy,
  orderModes,
  saveMode as defaultSaveMode,
  type ModeRecord,
} from "./modes.ipc";
import {
  buildSaveModeRequest,
  createModeEditorDraft,
  type ModeEditorDraft,
} from "./modes.draft";

// The render-facing slice of the controller. Stable identity per change (a new
// object only when one of these fields actually changes) so useSyncExternalStore
// callers don't tear or loop.
export interface ModeEditorSnapshot {
  modes: ModeRecord[];
  selectedModeId: string;
  modeDraft: ModeEditorDraft | null;
}

export type ModeEditorListener = () => void;

// Injectable seams so the controller is testable without a DOM, real IPC, or
// real timers. Defaults wire the production toast / save_mode call; the autosave
// timer hooks pass straight through to createAutosaveController.
export interface ModeEditorControllerOptions {
  t: Translator;
  toast?: (text: string) => void;
  saveMode?: typeof defaultSaveMode;
  createMode?: typeof defaultCreateMode;
  deleteMode?: typeof defaultDeleteMode;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
  /** Called after a mode is persisted, so the host can refresh the AppModel
   * (so Home readiness + the mode list reflect the edit). */
  onSaved?: () => void;
}

export interface ModeEditorController {
  getSnapshot(): ModeEditorSnapshot;
  subscribe(listener: ModeEditorListener): () => void;
  // Keep the translator current after a locale change (the old build read the
  // live module-level translate; here React pushes the fresh translator in).
  setTranslator(t: Translator): void;

  // Replace the whole mode list (boot-snapshot hydration / mode-list re-fetch).
  // Keeps custom modes while applying the persisted display order.
  hydrateModes(modes: readonly ModeRecord[]): void;

  // Auto-select the first mode when nothing valid is selected. Returns whether a
  // (re)selection happened so the caller can flip prompt-ready UI state.
  ensureSelection(): boolean;

  // Switch to `mode`, flushing pending edits first; no-op if already selected or
  // if the flush failed (mirrors the old guard). Returns whether selection moved.
  selectMode(mode: ModeRecord): Promise<boolean>;
  selectModeById(modeId: string): Promise<boolean>;
  // Header-click behaviour: re-clicking the open card flushes and collapses it.
  toggleMode(mode: ModeRecord): Promise<"expanded" | "collapsed" | "unchanged">;
  toggleModeById(modeId: string): Promise<"expanded" | "collapsed" | "unchanged">;
  deselect(): void;

  updateDraft(patch: Partial<ModeEditorDraft>): void;
  updatePromptBody(next: string): void;
  updateName(next: string): void;
  createMode(): Promise<string | null>;
  deleteMode(modeId: string): Promise<void>;
  commitHotkey(chord: string, policy: HotkeyConflictPolicy): Promise<void>;
  clearHotkey(): Promise<void>;
  commitHotkeyFor(
    modeId: string,
    chord: string,
    policy: HotkeyConflictPolicy,
  ): Promise<void>;
  clearHotkeyFor(modeId: string): Promise<void>;

  // Autosave scheduling — the React effects delegate here. The prompt autosave
  // is gated by the caller's prompt-ready flag (old `promptStatus === "ready"`).
  scheduleModeAutosave(): void;
  clearModeAutosave(): void;
  schedulePromptAutosave(): void;
  clearPromptAutosave(): void;

  // Flush both autosaves; resolves true only if both succeeded (or had nothing
  // pending). Never rejects.
  flushAll(): Promise<boolean>;
}

function modeDraftKey(d: ModeEditorDraft | null): string | null {
  if (!d) return null;
  return JSON.stringify({
    id: d.id,
    name: d.name,
    hotkey_chord: d.hotkey_chord,
    hotkey_enabled: d.hotkey_enabled,
    prompt_body: d.prompt_body,
  });
}

function promptDraftKey(d: ModeEditorDraft | null): string | null {
  if (!d) return null;
  return JSON.stringify({ id: d.id, body: d.prompt_body });
}

function replaceMode(modes: ModeRecord[], saved: ModeRecord): ModeRecord[] {
  const index = modes.findIndex((mode) => mode.id === saved.id);
  if (index === -1) return orderModes([...modes, saved]);
  return modes.map((mode) => (mode.id === saved.id ? saved : mode));
}

// Picks the key for a save pass: the mode-metadata save keys on the full draft,
// the prompt-body save keys on { id, body } only.
type DraftKeyFn = (d: ModeEditorDraft | null) => string | null;

export function createModeEditorController(
  options: ModeEditorControllerOptions,
): ModeEditorController {
  const toast = options.toast ?? defaultToast;
  const saveMode = options.saveMode ?? defaultSaveMode;
  const createModeFn = options.createMode ?? defaultCreateMode;
  const deleteModeFn = options.deleteMode ?? defaultDeleteMode;
  const onSaved = options.onSaved;

  let t = options.t;

  // The editor model (was page state + the mirrored refs).
  let modes: ModeRecord[] = [];
  let selectedModeId = "";
  let modeDraft: ModeEditorDraft | null = null;

  // Non-reactive bookkeeping (old `let` outside $state → refs).
  let persistedModeKey: string | null = null;
  let persistedPromptKey: string | null = null;

  // Cached render snapshot — only rebuilt when model fields change so identity is
  // stable for useSyncExternalStore.
  let snapshot: ModeEditorSnapshot = { modes, selectedModeId, modeDraft };
  const listeners = new Set<ModeEditorListener>();

  function emit(): void {
    snapshot = { modes, selectedModeId, modeDraft };
    for (const listener of listeners) listener();
  }

  async function persistDraft(
    snapshotDraft: ModeEditorDraft,
    options: {
      saveErrorToastKey: string;
      hotkeyConflictPolicy?: HotkeyConflictPolicy;
      adopt: "if-current-key" | "if-selected";
      keyFn?: DraftKeyFn;
    },
  ): Promise<void> {
    const snapshotKey = options.keyFn?.(snapshotDraft) ?? null;
    const original = modes.find((mode) => mode.id === snapshotDraft.id);
    if (!original) {
      throw new Error("Selected mode missing");
    }

    try {
      const saved = await saveMode(
        buildSaveModeRequest(
          original,
          snapshotDraft,
          options.hotkeyConflictPolicy ?? "reject",
        ),
      );
      if (!modes.some((mode) => mode.id === saved.id)) {
        return;
      }
      const savedDraft = createModeEditorDraft(saved);
      if (selectedModeId === saved.id) {
        persistedModeKey = modeDraftKey(savedDraft);
        persistedPromptKey = promptDraftKey(savedDraft);
      }

      modes = replaceMode(modes, saved);

      const shouldAdopt =
        options.adopt === "if-selected"
          ? selectedModeId === saved.id
          : selectedModeId === saved.id && options.keyFn?.(modeDraft) === snapshotKey;
      if (shouldAdopt) {
        modeDraft = savedDraft;
      }
      emit();

      toast(t("modes.savedToast"));
      // Notify the host so the AppModel refreshes — Home readiness + the model's
      // mode list must reflect a hotkey/prompt edit (plan §4.10 / §7).
      onSaved?.();
    } catch (err) {
      toast(t(options.saveErrorToastKey));
      throw err;
    }
  }

  // Unified, parameterised save (merges the old saveCurrentMode +
  // saveCurrentPrompt). `keyFn` selects the persisted-key family. On success
  // both persisted keys are refreshed (the old code did this in both functions)
  // and autosave adopts only if the selection + key are still the ones saved.
  async function save(
    keyFn: DraftKeyFn,
    options: {
      missingDraftError: string;
      saveErrorToastKey: string;
    },
  ): Promise<void> {
    const snapshotDraft = modeDraft;
    const snapshotKey = keyFn(snapshotDraft);
    if (!snapshotDraft || snapshotKey === null) {
      throw new Error(options.missingDraftError);
    }
    await persistDraft(snapshotDraft, {
      saveErrorToastKey: options.saveErrorToastKey,
      adopt: "if-current-key",
      keyFn,
    });
  }

  const saveCurrentMode = (): Promise<void> =>
    save(modeDraftKey, {
      missingDraftError: "No mode selected",
      saveErrorToastKey: "modes.modeSaveError",
    });

  // Saves the prompt body by persisting the full mode record (prompt_body is
  // inlined in Mode — no separate prompt command needed).
  const saveCurrentPrompt = (): Promise<void> =>
    save(promptDraftKey, {
      missingDraftError: "No prompt loaded",
      saveErrorToastKey: "modes.promptSaveError",
    });

  // Autosave controllers — created once; their getters read live controller
  // state (was: read via the mirrored refs).
  const modeAutosave: AutosaveController = createAutosaveController({
    getCurrentKey: () => modeDraftKey(modeDraft),
    getPersistedKey: () => persistedModeKey,
    save: () => saveCurrentMode(),
    setTimer: options.setTimer,
    clearTimer: options.clearTimer,
  });
  const promptAutosave: AutosaveController = createAutosaveController({
    getCurrentKey: () => promptDraftKey(modeDraft),
    getPersistedKey: () => persistedPromptKey,
    save: () => saveCurrentPrompt(),
    setTimer: options.setTimer,
    clearTimer: options.clearTimer,
  });

  function adoptSelection(mode: ModeRecord): void {
    selectedModeId = mode.id;
    const nextDraft = createModeEditorDraft(mode);
    modeDraft = nextDraft;
    persistedModeKey = modeDraftKey(nextDraft);
    persistedPromptKey = promptDraftKey(nextDraft);
    emit();
  }

  function deselect(): void {
    selectedModeId = "";
    modeDraft = null;
    persistedModeKey = null;
    persistedPromptKey = null;
    emit();
  }

  function draftForMode(modeId: string): ModeEditorDraft {
    const original = modes.find((mode) => mode.id === modeId);
    if (!original) throw new Error("Mode missing");
    if (modeId === selectedModeId && modeDraft) return modeDraft;
    return createModeEditorDraft(original);
  }

  return {
    getSnapshot(): ModeEditorSnapshot {
      return snapshot;
    },
    subscribe(listener: ModeEditorListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setTranslator(next: Translator): void {
      t = next;
    },

    hydrateModes(next: readonly ModeRecord[]): void {
      modes = orderModes(next);
      emit();
    },

    ensureSelection(): boolean {
      if (modes.length === 0) return false;
      const stillSelected = modes.some((mode) => mode.id === selectedModeId);
      if (selectedModeId && stillSelected) return false;
      adoptSelection(modes[0]!);
      return true;
    },

    async selectMode(mode: ModeRecord): Promise<boolean> {
      if (mode.id === selectedModeId) return false;
      const flushed = await this.flushAll();
      if (!flushed) return false;
      adoptSelection(mode);
      return true;
    },
    async selectModeById(modeId: string): Promise<boolean> {
      const mode = modes.find((next) => next.id === modeId);
      if (!mode) return false;
      return this.selectMode(mode);
    },
    async toggleMode(mode: ModeRecord): Promise<"expanded" | "collapsed" | "unchanged"> {
      if (mode.id === selectedModeId) {
        const flushed = await this.flushAll();
        if (!flushed) return "unchanged";
        deselect();
        return "collapsed";
      }
      const flushed = await this.flushAll();
      if (!flushed) return "unchanged";
      adoptSelection(mode);
      return "expanded";
    },
    async toggleModeById(modeId: string): Promise<"expanded" | "collapsed" | "unchanged"> {
      const mode = modes.find((next) => next.id === modeId);
      if (!mode) return "unchanged";
      return this.toggleMode(mode);
    },
    deselect,

    updateDraft(patch: Partial<ModeEditorDraft>): void {
      if (!modeDraft) return;
      modeDraft = { ...modeDraft, ...patch };
      emit();
    },
    updatePromptBody(next: string): void {
      if (!modeDraft) return;
      modeDraft = { ...modeDraft, prompt_body: next };
      emit();
    },
    updateName(next: string): void {
      if (!modeDraft) return;
      modeDraft = { ...modeDraft, name: next };
      emit();
    },
    async createMode(): Promise<string | null> {
      const flushed = await this.flushAll();
      if (!flushed) return null;
      try {
        const saved = await createModeFn(t("modes.newModeDefaultName"));
        modes = orderModes([...modes, saved]);
        adoptSelection(saved);
        onSaved?.();
        return saved.id;
      } catch {
        toast(t("modes.createError"));
        return null;
      }
    },
    async deleteMode(modeId: string): Promise<void> {
      const target = modes.find((mode) => mode.id === modeId);
      if (!target || target.built_in) return;
      const deletingSelected = selectedModeId === modeId;
      try {
        await deleteModeFn(modeId);
      } catch {
        toast(t("modes.deleteError"));
        return;
      }
      if (deletingSelected) {
        modeAutosave.clear();
        promptAutosave.clear();
      }
      modes = modes.filter((mode) => mode.id !== modeId);
      if (deletingSelected) deselect();
      else emit();
      onSaved?.();
    },
    async commitHotkey(
      chord: string,
      policy: HotkeyConflictPolicy,
    ): Promise<void> {
      if (!modeDraft) throw new Error("No mode selected");
      await this.commitHotkeyFor(modeDraft.id, chord, policy);
    },
    async clearHotkey(): Promise<void> {
      if (!modeDraft) throw new Error("No mode selected");
      await this.clearHotkeyFor(modeDraft.id);
    },
    async commitHotkeyFor(
      modeId: string,
      chord: string,
      policy: HotkeyConflictPolicy,
    ): Promise<void> {
      const baseDraft = draftForMode(modeId);
      await persistDraft(
        { ...baseDraft, hotkey_enabled: true, hotkey_chord: chord },
        {
          saveErrorToastKey: "modes.modeSaveError",
          hotkeyConflictPolicy: policy,
          adopt: "if-selected",
        },
      );
    },
    async clearHotkeyFor(modeId: string): Promise<void> {
      const baseDraft = draftForMode(modeId);
      await persistDraft(
        { ...baseDraft, hotkey_enabled: false, hotkey_chord: "" },
        {
          saveErrorToastKey: "modes.modeSaveError",
          hotkeyConflictPolicy: "reject",
          adopt: "if-selected",
        },
      );
    },

    scheduleModeAutosave(): void {
      modeAutosave.schedule();
    },
    clearModeAutosave(): void {
      modeAutosave.clear();
    },
    schedulePromptAutosave(): void {
      promptAutosave.schedule();
    },
    clearPromptAutosave(): void {
      promptAutosave.clear();
    },

    async flushAll(): Promise<boolean> {
      const results = await Promise.all([
        modeAutosave
          .flush()
          .then(() => true)
          .catch(() => false),
        promptAutosave
          .flush()
          .then(() => true)
          .catch(() => false),
      ]);
      return results.every(Boolean);
    },
  };
}
