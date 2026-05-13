import { describe, expect, it } from "vitest";

import {
  MODE_COMMANDS,
  CANONICAL_MODE_IDS,
  buildSaveModeRequest,
  canonicalModeRecords,
  createModeEditorDraft,
  hotkeyCaptureFromModifierRelease,
  hotkeyConflictCopy,
  modifierKeyId,
  prettyChord,
  type ModeRecord,
  type SaveModeRequest
} from "./modes.ipc";

describe("mode IPC model", () => {
  it("matches backend mode command names", () => {
    expect(MODE_COMMANDS).toEqual({
      listModes: "list_modes",
      saveMode: "save_mode"
    });
  });

  it("filters persisted modes down to the canonical redesign tabs in fixed order", () => {
    const defaultMode = { ...polishMode(), id: "default", name: "默认" };
    const translateMode = { ...polishMode(), id: "translate", name: "翻译" };
    const customMode = { ...polishMode(), id: "custom", name: "Custom" };

    expect(CANONICAL_MODE_IDS).toEqual(["default", "translate"]);
    expect(
      canonicalModeRecords([customMode, translateMode, defaultMode]).map((mode) => mode.id)
    ).toEqual(["default", "translate"]);
    expect(canonicalModeRecords([customMode, translateMode]).map((mode) => mode.id)).toEqual([
      "translate"
    ]);
  });

  it("serializes save requests with explicit reject and steal conflict policies", () => {
    const reject: SaveModeRequest = {
      mode: polishMode(),
      hotkey_conflict_policy: "reject"
    };
    const steal: SaveModeRequest = {
      mode: polishMode(),
      hotkey_conflict_policy: "steal"
    };

    expect(reject.hotkey_conflict_policy).toBe("reject");
    expect(steal.hotkey_conflict_policy).toBe("steal");
    expect(JSON.stringify(steal)).toContain("prompt_id");
  });

  it("provides both confirmation and rejection copy for hotkey conflicts", () => {
    expect(hotkeyConflictCopy("Quick")).toEqual({
      title: "Hotkey is already bound to Quick.",
      confirm: "Steal binding",
      reject: "Keep existing"
    });
  });

  it("creates editable mode drafts from persisted mode records", () => {
    const draft = createModeEditorDraft(polishMode());

    expect(draft).toEqual({
      id: "polish",
      name: "Polish",
      hotkey_enabled: true,
      hotkey_chord: "RightMeta",
      hotkey_style: "toggle",
      prompt_id: "default"
    });
  });

  it("captures single right alt via the modifier-release path", () => {
    expect(
      hotkeyCaptureFromModifierRelease({ key: "Alt", code: "AltRight" })
    ).toEqual({ hotkey_enabled: true, hotkey_chord: "RightAlt" });
  });

  it("captures Fn on macOS keyboards via the modifier-release path", () => {
    expect(
      hotkeyCaptureFromModifierRelease({ key: "Fn", code: "" })
    ).toEqual({ hotkey_enabled: true, hotkey_chord: "Fn" });
  });

  it("returns null for non-modifier release codes", () => {
    expect(
      hotkeyCaptureFromModifierRelease({ key: "a", code: "KeyA" })
    ).toBeNull();
  });

  it("modifierKeyId resolves modifier codes including the synthetic Fn", () => {
    expect(modifierKeyId("ControlLeft", "Control")).toBe("ControlLeft");
    expect(modifierKeyId("AltRight", "Alt")).toBe("AltRight");
    expect(modifierKeyId("MetaLeft", "Meta")).toBe("MetaLeft");
    expect(modifierKeyId("OSRight", "Meta")).toBe("OSRight");
    expect(modifierKeyId("", "Fn")).toBe("Fn");
    expect(modifierKeyId("KeyA", "a")).toBeNull();
    expect(modifierKeyId("Escape", "Escape")).toBeNull();
  });

  it("renders pretty chord labels", () => {
    expect(prettyChord("RightAlt")).toBe("Right Alt");
    expect(prettyChord("RightMeta")).toBe("Right Meta");
    expect(prettyChord("Fn")).toBe("Fn");
    expect(prettyChord("")).toBe("");
  });

  it("builds save requests from editable drafts with explicit conflict policy", () => {
    const original = polishMode();
    const draft = {
      ...createModeEditorDraft(original),
      name: "Polish CN",
      hotkey_enabled: true,
      hotkey_chord: "RightShift",
      hotkey_style: "hold" as const,
      prompt_id: "default"
    };

    expect(buildSaveModeRequest(original, draft, "steal")).toEqual({
      hotkey_conflict_policy: "steal",
      mode: {
        ...original,
        name: "Polish CN",
        hotkey: {
          chord: "RightShift",
          style: "hold"
        },
        prompt_id: "default"
      }
    });
  });

  it("clears hotkey when disabled", () => {
    const original = polishMode();
    const draft = {
      ...createModeEditorDraft(original),
      hotkey_enabled: false
    };
    const req = buildSaveModeRequest(original, draft, "reject");
    expect(req.mode.hotkey).toBeNull();
  });
});

function polishMode(): ModeRecord {
  return {
    id: "polish",
    name: "Polish",
    hotkey: {
      chord: "RightMeta",
      style: "toggle"
    },
    display_order: 1,
    built_in: true,
    prompt_id: "default"
  };
}
