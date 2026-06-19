// Page-local modes record helpers. Persistence goes through renderer/ipc.ts so
// the page never reaches for window.soto directly.

import { type Mode } from "@soto/core";

import { saveMode as saveModeCommand } from "../../../ipc";
import { CANONICAL_MODE_IDS, type CanonicalModeId } from "../../../shared/canonicalModes";

export type { Mode };

// ModeRecord is an alias for the @soto/core Mode type (the former generated
// ts-rs binding).
export type ModeRecord = Mode;

export type HotkeyConflictPolicy = "reject" | "steal";

export interface SaveModeRequest {
  mode: ModeRecord;
  hotkey_conflict_policy: HotkeyConflictPolicy;
}

export { CANONICAL_MODE_IDS, type CanonicalModeId };

export function isCanonicalMode(mode: ModeRecord): boolean {
  return (CANONICAL_MODE_IDS as readonly string[]).includes(mode.id);
}

// Stable order for the full mode list: built-ins (display_order 0,1) first, then
// custom modes by creation order. Keeps every mode — unlike the old
// orderCanonicalModes projection, which dropped non-canonical (user) modes.
export function orderModes(modes: readonly ModeRecord[]): ModeRecord[] {
  return [...modes].sort((a, b) => {
    if (a.display_order !== b.display_order) return a.display_order - b.display_order;
    return Number(a.created_at - b.created_at);
  });
}

// Persist a mode through the typed IPC adapter. Mirrors the old debug logging.
export async function saveMode(request: SaveModeRequest): Promise<ModeRecord> {
  console.debug("[soto-fe] save_mode request:", {
    mode_id: request.mode.id,
    name: request.mode.name,
    hotkey: request.mode.hotkey,
    conflict_policy: request.hotkey_conflict_policy,
  });
  try {
    const saved = await saveModeCommand(request.mode, request.hotkey_conflict_policy);
    console.debug("[soto-fe] save_mode result:", {
      mode_id: saved.id,
      hotkey: saved.hotkey,
      prompt_body_len: saved.prompt_body.length,
    });
    return saved;
  } catch (error) {
    console.debug("[soto-fe] save_mode error:", error);
    throw error;
  }
}
