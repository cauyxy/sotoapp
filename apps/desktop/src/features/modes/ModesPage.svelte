<script lang="ts">
  import { onDestroy, untrack } from "svelte";

  import PageHeader from "../../shared/ui/PageHeader.svelte";
  import { canonicalModeLabel } from "../../shared/modes";
  import { toast } from "../../shared/ui/toast";
  import { createAutosaveController } from "./modesAutosave";
  import { modesStore } from "./modesStore";
  import PromptEditor from "./PromptEditor.svelte";
  import TriggerEditor from "./TriggerEditor.svelte";
import { bindHotkeyCapture } from "./hotkeyCapture";
import PageFilterRow from "../../shared/ui/PageFilterRow.svelte";
  import {
    buildSaveModeRequest,
    canonicalModeRecords,
    createModeEditorDraft,
    saveMode,
    type ModeEditorDraft,
    type ModeRecord
  } from "./modes.ipc";
  import { readPrompt, writePrompt, type PromptDocument } from "./prompts.ipc";
import { t, translate } from "../../i18n";

  let { isActive = true }: { isActive?: boolean } = $props();

  let selectedModeId = $state("");
  let modeDraft = $state<ModeEditorDraft | null>(null);
  let promptDraft = $state<PromptDocument | null>(null);
  let promptStatus = $state<"empty" | "loading" | "ready" | "error">("empty");
  let promptError = $state<string | null>(null);
  let capturingHotkey = $state(false);
  let persistedModeKey: string | null = null;
  let persistedPromptKey: string | null = null;
  let selectionGeneration = 0;

  function modeDraftKey(d: ModeEditorDraft | null): string | null {
    if (!d) return null;
    return JSON.stringify({
      id: d.id,
      name: d.name,
      hotkey_chord: d.hotkey_chord,
      hotkey_enabled: d.hotkey_enabled,
      hotkey_style: d.hotkey_style,
      prompt_id: d.prompt_id
    });
  }

  function promptDraftKey(doc: PromptDocument | null): string | null {
    if (!doc) return null;
    return JSON.stringify({ id: doc.id, body: doc.body });
  }

  function replaceMode(modes: ModeRecord[], saved: ModeRecord): ModeRecord[] {
    const index = modes.findIndex((mode) => mode.id === saved.id);
    if (index === -1) return canonicalModeRecords([...modes, saved]);
    return modes.map((mode) => (mode.id === saved.id ? saved : mode));
  }

  async function saveCurrentMode() {
    const snapshotDraft = modeDraft;
    const snapshotKey = modeDraftKey(snapshotDraft);

    if (!snapshotDraft || snapshotKey === null) {
      throw new Error("No mode selected");
    }

    const original = $modesStore.find((mode) => mode.id === snapshotDraft.id);
    if (!original) {
      throw new Error("Selected mode missing");
    }

    try {
      const saved = await saveMode(buildSaveModeRequest(original, snapshotDraft, "steal"));
      const savedDraft = createModeEditorDraft(saved);
      const savedKey = modeDraftKey(savedDraft);
      persistedModeKey = savedKey;

      const nextModes = replaceMode($modesStore, saved);
      modesStore.set(nextModes);

      if (selectedModeId === saved.id && modeDraftKey(modeDraft) === snapshotKey) {
        modeDraft = savedDraft;
      }

      toast(translate("modes.savedToast"));
    } catch (err) {
      toast(translate("modes.modeSaveError"));
      throw err;
    }
  }

  async function saveCurrentPrompt() {
    const snapshot = promptDraft;
    const snapshotKey = promptDraftKey(snapshot);

    if (!snapshot || snapshotKey === null) {
      throw new Error("No prompt loaded");
    }

    try {
      const saved = await writePrompt(snapshot);
      persistedPromptKey = promptDraftKey(saved);
      if (selectedModeId && promptDraft && promptDraft.id === saved.id &&
          promptDraftKey(promptDraft) === snapshotKey) {
        promptDraft = saved;
      }
    } catch (err) {
      toast(translate("modes.promptSaveError"));
      throw err;
    }
  }

  const modeAutosaveController = createAutosaveController({
    getCurrentKey: () => modeDraftKey(modeDraft),
    getPersistedKey: () => persistedModeKey,
    save: () => saveCurrentMode()
  });

  const promptAutosaveController = createAutosaveController({
    getCurrentKey: () => promptDraftKey(promptDraft),
    getPersistedKey: () => persistedPromptKey,
    save: () => saveCurrentPrompt()
  });

  async function flushAll(): Promise<boolean> {
    const results = await Promise.all([
      modeAutosaveController.flush().then(() => true).catch(() => false),
      promptAutosaveController.flush().then(() => true).catch(() => false)
    ]);
    return results.every(Boolean);
  }

  async function loadPromptForMode(mode: ModeRecord, gen: number) {
    promptDraft = null;
    persistedPromptKey = null;
    promptError = null;
    promptStatus = "loading";
    try {
      const doc = await readPrompt(mode.prompt_id);
      if (gen !== selectionGeneration) return;
      promptDraft = doc;
      persistedPromptKey = promptDraftKey(doc);
      promptStatus = "ready";
    } catch (err) {
      if (gen !== selectionGeneration) return;
      promptError = String(err);
      promptStatus = "error";
    }
  }

  $effect(() => {
    const modes = $modesStore;
    if (modes.length === 0) return;
    untrack(() => {
      const stillSelected = modes.some((mode) => mode.id === selectedModeId);
      if (selectedModeId && stillSelected) return;
      const next = modes[0];
      const nextDraft = createModeEditorDraft(next);
      const myGen = ++selectionGeneration;
      selectedModeId = next.id;
      modeDraft = nextDraft;
      persistedModeKey = modeDraftKey(nextDraft);
      void loadPromptForMode(next, myGen);
    });
  });

  $effect(() => {
    modeDraft;
    modeAutosaveController.schedule();
    return () => modeAutosaveController.clear();
  });

  $effect(() => {
    promptDraft;
    if (promptStatus !== "ready") return;
    promptAutosaveController.schedule();
    return () => promptAutosaveController.clear();
  });

  $effect(() => {
    if (!isActive) {
      capturingHotkey = false;
      void flushAll();
    }
  });

  $effect(() => {
    if (!capturingHotkey) return;
    return bindHotkeyCapture({
      onCapture: (patch) => {
        updateDraft(patch);
        capturingHotkey = false;
      },
      onCancel: () => (capturingHotkey = false)
    });
  });

  onDestroy(() => {
    void flushAll();
  });

  async function selectMode(mode: ModeRecord) {
    if (mode.id === selectedModeId) return;
    const flushed = await flushAll();
    if (!flushed) return;
    const myGen = ++selectionGeneration;
    if (myGen !== selectionGeneration) return;
    selectedModeId = mode.id;
    const nextDraft = createModeEditorDraft(mode);
    modeDraft = nextDraft;
    persistedModeKey = modeDraftKey(nextDraft);
    capturingHotkey = false;
    await loadPromptForMode(mode, myGen);
  }

  function updateDraft(patch: Partial<ModeEditorDraft>) {
    if (!modeDraft) return;
    modeDraft = { ...modeDraft, ...patch };
  }

  function updatePromptBody(next: string) {
    if (!promptDraft) return;
    promptDraft = { ...promptDraft, body: next };
  }

  function retryLoadPrompt() {
    const current = $modesStore.find((m) => m.id === selectedModeId);
    if (!current) return;
    const myGen = ++selectionGeneration;
    void loadPromptForMode(current, myGen);
  }

  const capturedHotkeyChord = $derived(
    modeDraft && modeDraft.hotkey_enabled && modeDraft.hotkey_chord ? modeDraft.hotkey_chord : ""
  );

  const modePills = $derived(
    $modesStore.map((mode) => ({
      id: mode.id,
      label: canonicalModeLabel(translate, mode.id),
      marker: (mode.hotkey ? "ok" : undefined) as "ok" | undefined
    }))
  );

  function selectModeById(modeId: string) {
    const mode = $modesStore.find((next) => next.id === modeId);
    if (!mode) return;
    void selectMode(mode);
  }
</script>

{#snippet topControls()}
  <TriggerEditor
    chord={capturedHotkeyChord}
    capturing={capturingHotkey}
    onStartCapture={() => (capturingHotkey = true)}
  />
  <span class="segmented">
    <button
      type="button"
      class={modeDraft?.hotkey_style === "hold" ? "active" : ""}
      onclick={() => updateDraft({ hotkey_style: "hold" })}
    >{$t("modes.activationHold")}</button>
    <button
      type="button"
      class={modeDraft?.hotkey_style === "toggle" ? "active" : ""}
      onclick={() => updateDraft({ hotkey_style: "toggle" })}
    >{$t("modes.activationToggle")}</button>
  </span>
{/snippet}

<main class="page modes-page">
  <PageHeader title={$t("modes.title")} />

  <PageFilterRow
    pills={modePills}
    activeId={selectedModeId}
    onSelect={selectModeById}
  />

  {#if modeDraft}
    <div class="modes-workspace">
      <PromptEditor
        value={promptDraft?.body ?? ""}
        status={promptStatus}
        errorMessage={promptError}
        onChange={updatePromptBody}
        onRetry={retryLoadPrompt}
        {topControls}
      />
    </div>
  {/if}
</main>
