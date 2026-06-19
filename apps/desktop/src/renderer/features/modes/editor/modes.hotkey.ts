// Hotkey id/chord helpers — port of apps/desktop/src/features/modes/
// modes.hotkey.ts, reimplemented on top of @soto/core's chord utilities
// (modifierFromCode / serializeChord) instead of re-deriving modifier identity
// maps locally. hotkeyCaptureFromCombo remains here; prettyChord is re-exported
// from the renderer display helpers.

import {
  type Modifier,
  modifierFromCode,
  serializeChord,
} from "@soto/core";

import { type ModeEditorDraft } from "./modes.draft";

export { prettyChord } from "./modifierDisplay";

export const FN_KEY_ID = "Fn" as const;

// Identifies which modifier key is being pressed/released. Returns the stable id
// the capture state machine tracks (KeyboardEvent.code, or the synthetic "Fn"
// for macOS Fn). Returns null for non-modifier keys. Delegates the actual
// modifier classification to @soto/core's modifierFromCode.
export function modifierKeyId(code: string, key: string): string | null {
  if (code === "" && key === "Fn") return FN_KEY_ID;
  if (modifierFromCode(code, key) !== null) return code;
  return null;
}

function idToCanonical(id: string): Modifier | null {
  if (id === FN_KEY_ID) return "Fn";
  return modifierFromCode(id);
}

// Builds a draft patch from a set of held modifier ids. Returns null if the set
// is empty or any id is unrecognized. The chord is serialized in @soto/core's
// canonical order so it round-trips byte-identically with parseChord.
export function hotkeyCaptureFromCombo(
  modifierIds: readonly string[],
): Partial<ModeEditorDraft> | null {
  if (modifierIds.length === 0) return null;
  const canonical = new Set<Modifier>();
  for (const id of modifierIds) {
    const c = idToCanonical(id);
    if (c === null) return null;
    canonical.add(c);
  }
  if (canonical.size === 0) return null;
  return { hotkey_enabled: true, hotkey_chord: serializeChord([...canonical]) };
}
