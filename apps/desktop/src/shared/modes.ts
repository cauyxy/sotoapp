// Canonical mode metadata shared across features.
// Soto's product design pins the mode set to exactly three; this module is the
// single source of truth for the id list and their localized labels.

import type { Translator } from "../i18n";

export const CANONICAL_MODE_IDS = ["default", "translate"] as const;
export type CanonicalModeId = (typeof CANONICAL_MODE_IDS)[number];

export function isCanonicalModeId(id: string): id is CanonicalModeId {
  return (CANONICAL_MODE_IDS as readonly string[]).includes(id);
}

const CANONICAL_LABEL_KEYS: Record<CanonicalModeId, string> = {
  default: "modes.canonical.default",
  translate: "modes.canonical.translate"
};

// Resolves a canonical mode id to its localized display name. Non-canonical ids
// pass through unchanged — by product design this branch should be unreachable,
// but it keeps legacy history records with foreign processing_mode strings
// rendering as themselves rather than as a missing i18n key.
export function canonicalModeLabel(t: Translator, id: string): string {
  if (isCanonicalModeId(id)) return t(CANONICAL_LABEL_KEYS[id]);
  return id;
}
