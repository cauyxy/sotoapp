// Mode editor draft model + save-request builder + disjoint-chord validation —
// React/Electron port of apps/desktop/src/features/modes/modes.draft.ts.
// The disjoint check delegates to @soto/core's validateDisjoint so the modifier-
// intersection + canonical-order grammar matches the backend exactly rather than
// being re-derived here.

import { validateDisjoint, type Modifier } from "@soto/core";

import {
  type HotkeyConflictPolicy,
  type ModeRecord,
  type SaveModeRequest,
} from "./modes.ipc";

export interface ModeEditorDraft {
  id: string;
  name: string;
  hotkey_enabled: boolean;
  hotkey_chord: string;
  prompt_body: string;
}

export function createModeEditorDraft(mode: ModeRecord): ModeEditorDraft {
  return {
    id: mode.id,
    name: mode.name,
    hotkey_enabled: mode.hotkey !== null,
    hotkey_chord: mode.hotkey?.chord ?? "",
    prompt_body: mode.prompt_body,
  };
}

export function buildSaveModeRequest(
  original: ModeRecord,
  draft: ModeEditorDraft,
  hotkeyConflictPolicy: HotkeyConflictPolicy,
): SaveModeRequest {
  return {
    hotkey_conflict_policy: hotkeyConflictPolicy,
    mode: {
      ...original,
      name: draft.name.trim() || original.name,
      hotkey:
        draft.hotkey_enabled && draft.hotkey_chord
          ? { chord: draft.hotkey_chord }
          : null,
      prompt_body: draft.prompt_body,
    },
  };
}

export interface ChordDisjointConflict {
  conflictingModeId: string;
  conflictingModeName: string;
  sharedModifiers: Modifier[];
}

// Returns null when the draft's chord is disjoint from every enabled other
// mode's chord, or a conflict description (first overlap, in `others` order)
// otherwise. Thin adapter over @soto/core's validateDisjoint: an empty draft
// chord is "no shortcut" and short-circuits to null, and an empty/unparseable
// other chord is skipped (treated as never conflicting) so a malformed sibling
// never throws here.
export function validateChordDisjoint(
  draftChord: string,
  others: ReadonlyArray<{ id: string; name: string; chord: string }>,
): ChordDisjointConflict | null {
  if (!draftChord) return null;
  for (const other of others) {
    if (!other.chord) continue;
    let conflict;
    try {
      conflict = validateDisjoint([draftChord, other.chord]);
    } catch {
      // Either chord failed to parse; mirror the old behaviour of treating an
      // unparseable chord as an empty (never-conflicting) modifier set.
      continue;
    }
    if (conflict) {
      return {
        conflictingModeId: other.id,
        conflictingModeName: other.name,
        sharedModifiers: conflict.sharedModifiers,
      };
    }
  }
  return null;
}
