import {
  type HotkeyConflictPolicy,
  type HotkeyStyle,
  type ModeRecord,
  type SaveModeRequest
} from "./modes.ipc";

export interface ModeEditorDraft {
  id: string;
  name: string;
  hotkey_enabled: boolean;
  hotkey_chord: string;
  hotkey_style: HotkeyStyle;
  prompt_id: string;
}

export function createModeEditorDraft(mode: ModeRecord): ModeEditorDraft {
  return {
    id: mode.id,
    name: mode.name,
    hotkey_enabled: mode.hotkey !== null,
    hotkey_chord: mode.hotkey?.chord ?? "",
    hotkey_style: mode.hotkey?.style ?? "hold",
    prompt_id: mode.prompt_id
  };
}

export function buildSaveModeRequest(
  original: ModeRecord,
  draft: ModeEditorDraft,
  hotkeyConflictPolicy: HotkeyConflictPolicy
): SaveModeRequest {
  return {
    hotkey_conflict_policy: hotkeyConflictPolicy,
    mode: {
      ...original,
      name: draft.name.trim() || original.name,
      hotkey:
        draft.hotkey_enabled && draft.hotkey_chord
          ? { chord: draft.hotkey_chord, style: draft.hotkey_style }
          : null,
      prompt_id: draft.prompt_id
    }
  };
}
