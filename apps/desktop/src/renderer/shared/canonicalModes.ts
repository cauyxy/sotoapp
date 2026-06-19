// Canonical mode metadata for the renderer. The canonical id list + its type
// guard are the single source of truth in @soto/core's mode catalog (shared
// with the SQLite seed); this module re-exports them and owns only the
// renderer-specific concern: localized display labels. Consumed by the Modes
// feature folder and the History page.

import {
  CANONICAL_MODE_IDS,
  isCanonicalModeId,
  type CanonicalModeId,
} from "@soto/core";
import type { Translator } from "../i18n";

export { CANONICAL_MODE_IDS, isCanonicalModeId, type CanonicalModeId };

const CANONICAL_LABEL_KEYS: Record<CanonicalModeId, string> = {
  default: "modes.canonical.default",
  translate: "modes.canonical.translate",
};

// Resolves a canonical mode id to its localized display name. Non-canonical ids
// return null so callers can fall back to the persisted custom mode name.
export function canonicalModeLabel(t: Translator, id: string): string | null {
  if (isCanonicalModeId(id)) return t(CANONICAL_LABEL_KEYS[id]);
  return null;
}
