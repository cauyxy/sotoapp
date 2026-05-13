import { invoke } from "@tauri-apps/api/core";

import { CANONICAL_MODE_IDS, type CanonicalModeId } from "../../shared/modes";

export const MODE_COMMANDS = {
  listModes: "list_modes",
  saveMode: "save_mode"
} as const;

export { CANONICAL_MODE_IDS, type CanonicalModeId };

export type HotkeyStyle = "hold" | "toggle";
export type HotkeyConflictPolicy = "reject" | "steal";

export interface HotkeyBinding {
  chord: string;
  style: HotkeyStyle;
}

export interface ModeRecord {
  id: string;
  name: string;
  hotkey: HotkeyBinding | null;
  display_order: number;
  built_in: boolean;
  prompt_id: string;
}

export interface SaveModeRequest {
  mode: ModeRecord;
  hotkey_conflict_policy: HotkeyConflictPolicy;
}

export function isCanonicalMode(mode: ModeRecord): boolean {
  return (CANONICAL_MODE_IDS as readonly string[]).includes(mode.id);
}

export function canonicalModeRecords(modes: readonly ModeRecord[]): ModeRecord[] {
  const byId = new Map(modes.map((mode) => [mode.id, mode]));
  return CANONICAL_MODE_IDS.map((id) => byId.get(id)).filter(
    (mode): mode is ModeRecord => mode !== undefined
  );
}

export function hotkeyConflictCopy(conflictingModeName: string): {
  title: string;
  confirm: string;
  reject: string;
} {
  return {
    title: `Hotkey is already bound to ${conflictingModeName}.`,
    confirm: "Steal binding",
    reject: "Keep existing"
  };
}

export async function listModes(): Promise<ModeRecord[]> {
  return invoke(MODE_COMMANDS.listModes);
}

export async function saveMode(request: SaveModeRequest): Promise<ModeRecord> {
  console.debug("[soto-fe] save_mode request:", {
    mode_id: request.mode.id,
    name: request.mode.name,
    hotkey: request.mode.hotkey,
    conflict_policy: request.hotkey_conflict_policy
  });
  try {
    const saved = await invoke<ModeRecord>(MODE_COMMANDS.saveMode, { request });
    console.debug("[soto-fe] save_mode result:", {
      mode_id: saved.id,
      hotkey: saved.hotkey
    });
    return saved;
  } catch (error) {
    console.debug("[soto-fe] save_mode error:", error);
    throw error;
  }
}

// Backward-compatible barrel: keeps existing call sites importing from
// "./modes.ipc" working after the modes module was split into focused files
// (modes.hotkey, modes.draft).
export {
  FN_KEY_ID,
  hotkeyCaptureFromModifierRelease,
  modifierKeyId,
  prettyChord,
  type HotkeyModifierReleaseCaptureInput
} from "./modes.hotkey";

export {
  buildSaveModeRequest,
  createModeEditorDraft,
  type ModeEditorDraft
} from "./modes.draft";
