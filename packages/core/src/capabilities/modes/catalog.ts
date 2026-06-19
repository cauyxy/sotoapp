// Canonical built-in mode catalog — the single source of truth for Soto's
// fixed, ordered built-in mode set. Both the SQLite seed (apps/desktop store
// `builtInModes`) and the renderer canonical-label helper consume this, so a
// new built-in mode (or a changed default) is a one-place edit here instead of
// drifting across the main-process seed and the renderer id list.
//
// Pure / data-only: timestamps are injected by the caller via
// `canonicalModeRecords(now)` so this module stays deterministic and clock-free.

import type { Mode } from "../../contract/schema.js";
import { DEFAULT_DICTATION_PROMPT } from "./defaultDictationPrompt.js";
import { DEFAULT_TRANSLATE_PROMPT } from "./defaultTranslatePrompt.js";

/** The pinned, ordered canonical voice-mode ids. `display_order` mirrors this order. */
export const CANONICAL_MODE_IDS = ["default", "translate"] as const;
export type CanonicalModeId = (typeof CANONICAL_MODE_IDS)[number];

/** Type guard: is `id` one of the canonical built-in mode ids? */
export function isCanonicalModeId(id: string): id is CanonicalModeId {
  return (CANONICAL_MODE_IDS as readonly string[]).includes(id);
}

/**
 * A built-in mode definition without timestamps. The store seed and any other
 * consumer stamp `created_at`/`updated_at` via `canonicalModeRecords(now)`.
 */
export type BuiltInModeDefinition = Omit<Mode, "created_at" | "updated_at">;

/**
 * The built-in mode definitions, in canonical order. Field values are
 * product-pinned:
 *  - `default`   — tap the Right Command key to start/stop dictation. macOS
 *                  exposes left/right modifiers separately; users normally say
 *                  "Command" while this default pins the right-side key.
 *                  Rebindable in Modes.
 *  - `translate` — dictation mode, no out-of-box hotkey.
 */
export const BUILT_IN_MODE_DEFINITIONS: readonly BuiltInModeDefinition[] = [
  {
    id: "default",
    name: "Default",
    prompt_body: DEFAULT_DICTATION_PROMPT,
    hotkey: { chord: "RightMeta" },
    display_order: 0,
    built_in: true,
  },
  {
    id: "translate",
    name: "Translate",
    prompt_body: DEFAULT_TRANSLATE_PROMPT,
    hotkey: null,
    display_order: 1,
    built_in: true,
  },
];

/**
 * Full `Mode` records for the built-in catalog, stamped with the given clock
 * (unix-ms). Used by the store seed; the records round-trip through
 * `ModeSchema`.
 */
export function canonicalModeRecords(now: number): Mode[] {
  const ts = BigInt(now);
  return BUILT_IN_MODE_DEFINITIONS.map((def) => ({
    ...def,
    created_at: ts,
    updated_at: ts,
  }));
}
