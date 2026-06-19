import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createModeEditorController,
  type ModeEditorController,
} from "./modeEditorController";
import { type ModeRecord } from "./modes.ipc";
import { AUTOSAVE_DELAY_MS } from "./modesAutosave";

// Minimal translator: echoes the key plus any interpolation values so the test
// can assert which message fired without owning the i18n table.
const t = (key: string, opts?: Record<string, string | number | boolean>) =>
  opts ? `${key}:${JSON.stringify(opts)}` : key;

function makeMode(overrides: Partial<ModeRecord> = {}): ModeRecord {
  return {
    id: "default",
    name: "Default",
    hotkey: null,
    prompt_body: "",
    display_order: 0,
    built_in: true,
    created_at: 0n,
    updated_at: 0n,
    ...overrides,
  };
}

// The default list order is driven by persisted display_order, with custom modes
// preserved after the built-ins.
const MODE_A = makeMode({
  id: "default",
  name: "Default",
  prompt_body: "alpha",
  display_order: 0,
});
const MODE_B = makeMode({
  id: "translate",
  name: "Translate",
  prompt_body: "beta",
  display_order: 1,
});
const MODE_CUSTOM = makeMode({
  id: "mode.custom",
  name: "Custom",
  prompt_body: "gamma",
  display_order: 2,
  built_in: false,
  created_at: 10n,
  updated_at: 10n,
});

type SaveModeFn = NonNullable<
  Parameters<typeof createModeEditorController>[0]["saveMode"]
>;
type CreateModeFn = (name: string) => Promise<ModeRecord>;
type DeleteModeFn = (modeId: string) => Promise<void>;

interface HarnessOptions {
  createMode?: CreateModeFn;
  deleteMode?: DeleteModeFn;
}

interface Harness {
  controller: ModeEditorController;
  saveMode: ReturnType<typeof vi.fn<SaveModeFn>>;
  createMode: ReturnType<typeof vi.fn<CreateModeFn>>;
  deleteMode: ReturnType<typeof vi.fn<DeleteModeFn>>;
  toast: ReturnType<typeof vi.fn>;
  onSaved: ReturnType<typeof vi.fn>;
}

function harness(saveImpl?: SaveModeFn, options: HarnessOptions = {}): Harness {
  const saveMode = vi.fn<SaveModeFn>(
    saveImpl ??
      // Default: echo back the mode in the request as the persisted record.
      ((request) => Promise.resolve(request.mode)),
  );
  const createMode = vi.fn<CreateModeFn>(
    options.createMode ??
      ((name) =>
        Promise.resolve(
          makeMode({
            id: "mode.created",
            name,
            display_order: 99,
            built_in: false,
          }),
        )),
  );
  const deleteMode = vi.fn<DeleteModeFn>(options.deleteMode ?? (async () => {}));
  const toast = vi.fn();
  const onSaved = vi.fn();
  const controller = createModeEditorController({
    t,
    toast,
    saveMode,
    createMode,
    deleteMode,
    onSaved,
  });
  return { controller, saveMode, createMode, deleteMode, toast, onSaved };
}

describe("createModeEditorController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts empty and exposes a stable snapshot until a change", () => {
    const { controller } = harness();
    const first = controller.getSnapshot();
    expect(first).toEqual({ modes: [], selectedModeId: "", modeDraft: null });
    // No mutation → identical reference (no tearing for useSyncExternalStore).
    expect(controller.getSnapshot()).toBe(first);
  });

  it("hydrates + orders the full mode list and notifies subscribers", () => {
    const { controller } = harness();
    const listener = vi.fn();
    controller.subscribe(listener);

    controller.hydrateModes([MODE_CUSTOM, MODE_B, MODE_A]);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().modes.map((m) => m.id)).toEqual([
      "default",
      "translate",
      "mode.custom",
    ]);
  });

  it("ensureSelection adopts the first mode and seeds the draft once", () => {
    const { controller } = harness();
    controller.hydrateModes([MODE_A, MODE_B]);

    expect(controller.ensureSelection()).toBe(true);
    const snap = controller.getSnapshot();
    expect(snap.selectedModeId).toBe("default");
    expect(snap.modeDraft?.prompt_body).toBe("alpha");

    // Already validly selected → no-op.
    expect(controller.ensureSelection()).toBe(false);
  });

  it("ensureSelection re-selects when the current selection vanishes", () => {
    const { controller } = harness();
    controller.hydrateModes([MODE_A, MODE_B]);
    controller.ensureSelection();

    // Drop the selected mode from the list.
    controller.hydrateModes([MODE_B]);
    expect(controller.ensureSelection()).toBe(true);
    expect(controller.getSnapshot().selectedModeId).toBe("translate");
  });

  it("does not autosave a no-op edit (draft equals persisted)", async () => {
    const { controller, saveMode } = harness();
    controller.hydrateModes([MODE_A]);
    controller.ensureSelection();

    // Re-apply the same prompt body (no real change vs persisted key).
    controller.updatePromptBody("alpha");
    controller.scheduleModeAutosave();
    controller.schedulePromptAutosave();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + 10);

    expect(saveMode).not.toHaveBeenCalled();
  });

  it("debounced prompt edit persists once and refreshes the persisted key", async () => {
    const { controller, saveMode } = harness();
    controller.hydrateModes([MODE_A]);
    controller.ensureSelection();

    controller.updatePromptBody("alpha-edited");
    controller.schedulePromptAutosave();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + 10);

    expect(saveMode).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().modeDraft?.prompt_body).toBe("alpha-edited");

    // The key is now persisted: a second schedule of the same body is a no-op.
    controller.schedulePromptAutosave();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + 10);
    expect(saveMode).toHaveBeenCalledTimes(1);
  });

  it("merged save persists a name edit through the mode autosave path", async () => {
    const { controller, saveMode, toast } = harness();
    controller.hydrateModes([MODE_A]);
    controller.ensureSelection();

    controller.updateDraft({ name: "Renamed" });
    controller.scheduleModeAutosave();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + 10);

    expect(saveMode).toHaveBeenCalledTimes(1);
    const req = saveMode.mock.calls[0]![0];
    expect(req.mode.name).toBe("Renamed");
    expect(req.hotkey_conflict_policy).toBe("reject");
    expect(toast).toHaveBeenCalledWith("modes.savedToast");
  });

  it("updateName patches the draft name and notifies subscribers", async () => {
    const { controller } = harness();
    const listener = vi.fn();
    controller.subscribe(listener);
    controller.hydrateModes([MODE_CUSTOM]);
    await controller.selectModeById("mode.custom");
    listener.mockClear();

    controller.updateName("Renamed");

    expect(controller.getSnapshot().modeDraft?.name).toBe("Renamed");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("createMode inserts the new mode, selects and expands it", async () => {
    const created = makeMode({
      id: "mode.new",
      name: "新模式",
      prompt_body: "",
      display_order: 2,
      built_in: false,
      created_at: 0n,
      updated_at: 0n,
    });
    const createMode = vi.fn<CreateModeFn>(async () => created);
    const { controller, onSaved } = harness(undefined, { createMode });

    controller.hydrateModes([MODE_A]);
    const id = await controller.createMode();

    expect(createMode).toHaveBeenCalledWith("modes.newModeDefaultName");
    expect(id).toBe("mode.new");
    const snap = controller.getSnapshot();
    expect(snap.modes.some((m) => m.id === "mode.new")).toBe(true);
    expect(snap.selectedModeId).toBe("mode.new");
    expect(snap.modeDraft?.name).toBe("新模式");
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("createMode returns null and skips IPC when pending autosave fails", async () => {
    const createMode = vi.fn<CreateModeFn>();
    const { controller } = harness(
      async () => {
        throw new Error("boom");
      },
      { createMode },
    );
    controller.hydrateModes([MODE_A]);
    controller.ensureSelection();
    controller.updateDraft({ name: "Dirty" });

    await expect(controller.createMode()).resolves.toBeNull();
    expect(createMode).not.toHaveBeenCalled();
    expect(controller.getSnapshot().selectedModeId).toBe("default");
  });

  it("createMode returns null and toasts on IPC error", async () => {
    const createMode = vi.fn<CreateModeFn>(async () => {
      throw new Error("backend unavailable");
    });
    const { controller, toast, onSaved } = harness(undefined, { createMode });
    controller.hydrateModes([MODE_A]);

    await expect(controller.createMode()).resolves.toBeNull();

    expect(toast).toHaveBeenCalledWith("modes.createError");
    expect(controller.getSnapshot().modes.map((m) => m.id)).toEqual(["default"]);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("deleteMode removes the mode and clears the selection", async () => {
    const deleteMode = vi.fn<DeleteModeFn>(async () => {});
    const { controller, onSaved } = harness(undefined, { deleteMode });
    controller.hydrateModes([MODE_CUSTOM]);
    await controller.selectModeById("mode.custom");

    await controller.deleteMode("mode.custom");

    expect(deleteMode).toHaveBeenCalledWith("mode.custom");
    expect(controller.getSnapshot().modes.some((m) => m.id === "mode.custom")).toBe(false);
    expect(controller.getSnapshot().selectedModeId).toBe("");
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("deleteMode ignores built-in modes", async () => {
    const deleteMode = vi.fn<DeleteModeFn>(async () => {});
    const { controller, onSaved } = harness(undefined, { deleteMode });
    controller.hydrateModes([MODE_A]);
    await controller.selectModeById("default");

    await controller.deleteMode("default");

    expect(deleteMode).not.toHaveBeenCalled();
    expect(controller.getSnapshot().modes.map((m) => m.id)).toEqual(["default"]);
    expect(controller.getSnapshot().selectedModeId).toBe("default");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("deleteMode ignores an in-flight autosave result for the deleted mode", async () => {
    let resolveSave!: () => void;
    const saveMode = vi.fn<SaveModeFn>(
      (request) =>
        new Promise<ModeRecord>((resolve) => {
          resolveSave = () => resolve({ ...request.mode, name: "Saved late" });
        }),
    );
    const deleteMode = vi.fn<DeleteModeFn>(async () => {});
    const { controller } = harness(saveMode, { deleteMode });
    controller.hydrateModes([MODE_CUSTOM]);
    await controller.selectModeById("mode.custom");
    controller.updateName("Dirty");

    const flush = controller.flushAll();
    await controller.deleteMode("mode.custom");
    resolveSave();
    await flush;

    expect(controller.getSnapshot().modes.some((m) => m.id === "mode.custom")).toBe(false);
    expect(controller.getSnapshot().selectedModeId).toBe("");
  });

  it("deleteMode toasts and keeps local state on IPC error", async () => {
    const deleteMode = vi.fn<DeleteModeFn>(async () => {
      throw new Error("backend unavailable");
    });
    const { controller, toast, onSaved } = harness(undefined, { deleteMode });
    controller.hydrateModes([MODE_CUSTOM]);
    await controller.selectModeById("mode.custom");

    await controller.deleteMode("mode.custom");

    expect(toast).toHaveBeenCalledWith("modes.deleteError");
    expect(controller.getSnapshot().modes.some((m) => m.id === "mode.custom")).toBe(true);
    expect(controller.getSnapshot().selectedModeId).toBe("mode.custom");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("commitHotkey persists a candidate with the requested policy and updates the draft on success", async () => {
    const { controller, saveMode } = harness();
    controller.hydrateModes([MODE_A]);
    controller.ensureSelection();

    await controller.commitHotkey("RightCtrl", "steal");

    expect(saveMode).toHaveBeenCalledTimes(1);
    expect(saveMode.mock.calls[0]![0]).toMatchObject({
      hotkey_conflict_policy: "steal",
      mode: { hotkey: { chord: "RightCtrl" } },
    });
    expect(controller.getSnapshot().modeDraft).toMatchObject({
      hotkey_enabled: true,
      hotkey_chord: "RightCtrl",
    });

    controller.scheduleModeAutosave();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + 10);
    expect(saveMode).toHaveBeenCalledTimes(1);
  });

  it("failed commitHotkey leaves the draft on the last persisted chord", async () => {
    const { controller, saveMode } = harness(async () => {
      throw new Error("boom");
    });
    controller.hydrateModes([
      makeMode({ id: "default", name: "Default", hotkey: { chord: "RightCtrl" } }),
    ]);
    controller.ensureSelection();

    await expect(controller.commitHotkey("LeftCtrl", "reject")).rejects.toThrow("boom");

    expect(controller.getSnapshot().modeDraft).toMatchObject({
      hotkey_enabled: true,
      hotkey_chord: "RightCtrl",
    });
    controller.scheduleModeAutosave();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + 10);
    expect(saveMode).toHaveBeenCalledTimes(1);
  });

  it("clearHotkey unbinds through an explicit save", async () => {
    const { controller, saveMode } = harness();
    controller.hydrateModes([
      makeMode({ id: "default", name: "Default", hotkey: { chord: "RightCtrl" } }),
    ]);
    controller.ensureSelection();

    await controller.clearHotkey();

    expect(saveMode).toHaveBeenCalledTimes(1);
    expect(saveMode.mock.calls[0]![0]).toMatchObject({
      hotkey_conflict_policy: "reject",
      mode: { hotkey: null },
    });
    expect(controller.getSnapshot().modeDraft).toMatchObject({
      hotkey_enabled: false,
      hotkey_chord: "",
    });
  });

  it("notifies onSaved after a successful save (so the host can refresh the model)", async () => {
    const { controller, onSaved } = harness();
    controller.hydrateModes([MODE_A]);
    controller.ensureSelection();

    controller.updateDraft({ name: "Renamed" });
    controller.scheduleModeAutosave();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + 10);

    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("surfaces save failures from backend hotkey conflict rejection", async () => {
    const { controller, onSaved } = harness(async () => {
      throw new Error("backend conflict");
    });
    controller.hydrateModes([
      MODE_A,
      makeMode({ id: "translate", name: "Translate", hotkey: { chord: "LeftMeta+LeftShift" } }),
    ]);
    controller.ensureSelection(); // selects "default"
    controller.updateDraft({ hotkey_enabled: true, hotkey_chord: "LeftMeta+LeftShift" });

    await expect(controller.flushAll()).resolves.toBe(false);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("autosave sends conflicting hotkey drafts with reject policy and lets the backend reject", async () => {
    const { controller, saveMode, toast } = harness(async () => {
      throw new Error("backend conflict");
    });
    // The sibling mode already owns LeftMeta+LeftShift (chord tokens must be the
    // canonical @soto/core grammar, not "cmd"/"shift" — an unparseable chord is
    // treated as never-conflicting).
    controller.hydrateModes([
      MODE_A,
      makeMode({
        id: "translate",
        name: "Translate",
        hotkey: { chord: "LeftMeta+LeftShift" },
      }),
    ]);
    controller.ensureSelection(); // selects "default"

    // Give the selected mode a chord that shares all modifiers with the sibling.
    controller.updateDraft({
      hotkey_enabled: true,
      hotkey_chord: "LeftMeta+LeftShift",
    });
    await expect(controller.flushAll()).resolves.toBe(false);

    expect(saveMode).toHaveBeenCalledTimes(1);
    expect(saveMode.mock.calls[0]![0].hotkey_conflict_policy).toBe("reject");
    expect(toast).toHaveBeenCalledWith("modes.modeSaveError");
  });

  it("flushAll resolves true when nothing is pending", async () => {
    const { controller } = harness();
    controller.hydrateModes([MODE_A]);
    controller.ensureSelection();
    await expect(controller.flushAll()).resolves.toBe(true);
  });

  it("flushAll resolves false and surfaces an error toast when a save throws", async () => {
    const { controller, toast } = harness(async () => {
      throw new Error("boom");
    });
    controller.hydrateModes([MODE_A]);
    controller.ensureSelection();

    controller.updatePromptBody("alpha-edited");
    await expect(controller.flushAll()).resolves.toBe(false);
    expect(toast).toHaveBeenCalledWith("modes.promptSaveError");
  });

  it("selectMode flushes pending edits first, then switches selection", async () => {
    const { controller, saveMode } = harness();
    controller.hydrateModes([MODE_A, MODE_B]);
    controller.ensureSelection(); // "default"

    controller.updatePromptBody("alpha-edited"); // pending mode + prompt edit

    const moved = await controller.selectMode(MODE_B);
    expect(moved).toBe(true);
    expect(saveMode).toHaveBeenCalled(); // pending edit flushed before switch
    expect(controller.getSnapshot().selectedModeId).toBe("translate");
    expect(controller.getSnapshot().modeDraft?.prompt_body).toBe("beta");
  });

  it("selectMode is a no-op when the target is already selected", async () => {
    const { controller, saveMode } = harness();
    controller.hydrateModes([MODE_A, MODE_B]);
    controller.ensureSelection(); // "default"

    expect(await controller.selectMode(MODE_A)).toBe(false);
    expect(saveMode).not.toHaveBeenCalled();
  });

  it("selectMode does not switch when the pre-flush save fails", async () => {
    const { controller } = harness(async () => {
      throw new Error("boom");
    });
    controller.hydrateModes([MODE_A, MODE_B]);
    controller.ensureSelection(); // "default"

    controller.updatePromptBody("alpha-edited"); // makes the flush attempt a save

    expect(await controller.selectMode(MODE_B)).toBe(false);
    expect(controller.getSnapshot().selectedModeId).toBe("default");
  });

  it("toggleMode collapses the open mode after flushing pending edits", async () => {
    const { controller, saveMode } = harness();
    controller.hydrateModes([MODE_A, MODE_B]);
    controller.ensureSelection(); // "default"

    controller.updatePromptBody("alpha-edited");
    await expect(controller.toggleMode(MODE_A)).resolves.toBe("collapsed");

    expect(saveMode).toHaveBeenCalled();
    expect(controller.getSnapshot().selectedModeId).toBe("");
    expect(controller.getSnapshot().modeDraft).toBeNull();
  });

  it("toggleMode stays open when the pre-collapse flush fails", async () => {
    const { controller } = harness(async () => {
      throw new Error("boom");
    });
    controller.hydrateModes([MODE_A, MODE_B]);
    controller.ensureSelection(); // "default"

    controller.updatePromptBody("alpha-edited");
    await expect(controller.toggleMode(MODE_A)).resolves.toBe("unchanged");

    expect(controller.getSnapshot().selectedModeId).toBe("default");
    expect(controller.getSnapshot().modeDraft?.prompt_body).toBe("alpha-edited");
  });

  it("commitHotkeyFor edits a non-selected mode without disturbing the selection", async () => {
    const { controller, saveMode } = harness();
    controller.hydrateModes([MODE_A, MODE_B]);
    controller.ensureSelection(); // "default"
    controller.updatePromptBody("alpha-edited");

    await controller.commitHotkeyFor("translate", "RightCtrl", "steal");

    expect(saveMode).toHaveBeenCalledTimes(1);
    expect(saveMode.mock.calls[0]![0]).toMatchObject({
      hotkey_conflict_policy: "steal",
      mode: { id: "translate", prompt_body: "beta", hotkey: { chord: "RightCtrl" } },
    });
    expect(controller.getSnapshot().selectedModeId).toBe("default");
    expect(controller.getSnapshot().modeDraft?.prompt_body).toBe("alpha-edited");
  });

  it("commitHotkeyFor on a non-selected mode does not dirty the selected draft", async () => {
    const { controller, saveMode } = harness();
    controller.hydrateModes([MODE_A, MODE_B]);
    controller.ensureSelection(); // "default"

    await controller.commitHotkeyFor("translate", "RightCtrl", "steal");
    await expect(controller.flushAll()).resolves.toBe(true);

    expect(saveMode).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().selectedModeId).toBe("default");
    expect(controller.getSnapshot().modeDraft?.prompt_body).toBe("alpha");
  });

  it("commitHotkeyFor uses the live draft when editing the selected mode", async () => {
    const { controller, saveMode } = harness();
    controller.hydrateModes([MODE_A, MODE_B]);
    controller.ensureSelection(); // "default"
    controller.updatePromptBody("alpha-edited");

    await controller.commitHotkeyFor("default", "RightCtrl", "reject");

    expect(saveMode.mock.calls[0]![0]).toMatchObject({
      mode: { id: "default", prompt_body: "alpha-edited", hotkey: { chord: "RightCtrl" } },
    });
    expect(controller.getSnapshot().modeDraft).toMatchObject({
      id: "default",
      prompt_body: "alpha-edited",
      hotkey_chord: "RightCtrl",
    });
  });

  it("selectModeById resolves the record from the list", async () => {
    const { controller } = harness();
    controller.hydrateModes([MODE_A, MODE_B]);
    controller.ensureSelection();

    expect(await controller.selectModeById("translate")).toBe(true);
    expect(controller.getSnapshot().selectedModeId).toBe("translate");
    // Unknown id → no-op.
    expect(await controller.selectModeById("nope")).toBe(false);
  });
});
