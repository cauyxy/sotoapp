import { describe, expect, it } from "vitest";

import { ModeSchema } from "../../contract/schema.js";
import {
  BUILT_IN_MODE_DEFINITIONS,
  CANONICAL_MODE_IDS,
  canonicalModeRecords,
  isCanonicalModeId,
} from "./catalog.js";
import { DEFAULT_DICTATION_PROMPT } from "./defaultDictationPrompt.js";
import { DEFAULT_TRANSLATE_PROMPT } from "./defaultTranslatePrompt.js";

describe("canonical mode catalog", () => {
  it("pins the canonical mode id list and order", () => {
    expect([...CANONICAL_MODE_IDS]).toEqual(["default", "translate"]);
  });

  it("keeps built-in definitions in sync with the canonical id list", () => {
    // Single source of truth: the definitions and the id list must agree, in
    // order, so adding a built-in mode is a one-place change.
    expect(BUILT_IN_MODE_DEFINITIONS.map((d) => d.id)).toEqual([...CANONICAL_MODE_IDS]);
    BUILT_IN_MODE_DEFINITIONS.forEach((def, index) => {
      expect(def.display_order).toBe(index);
      expect(def.built_in).toBe(true);
    });
  });

  it("recognizes canonical ids and rejects foreign ones", () => {
    expect(isCanonicalModeId("default")).toBe(true);
    expect(isCanonicalModeId("translate")).toBe(true);
    expect(isCanonicalModeId("rewrite")).toBe(false);
    expect(isCanonicalModeId("custom-mode")).toBe(false);
    expect(isCanonicalModeId("")).toBe(false);
  });

  it("carries the product-pinned per-mode field values", () => {
    const byId = Object.fromEntries(BUILT_IN_MODE_DEFINITIONS.map((d) => [d.id, d]));
    // Default: tap-RightMeta dictation, built-in prompt.
    expect(byId["default"]!.hotkey).toEqual({ chord: "RightMeta" });
    expect(byId["default"]!.prompt_body).toBe(DEFAULT_DICTATION_PROMPT);
    // Translate: no hotkey out of the box, dictation mode.
    expect(byId["translate"]!.hotkey).toBeNull();
    expect(byId["translate"]!.prompt_body).toBe(DEFAULT_TRANSLATE_PROMPT);
    expect(byId["rewrite"]).toBeUndefined();
  });

  it("stamps both timestamps from the injected clock", () => {
    const now = 1_700_000_000_000;
    const records = canonicalModeRecords(now);
    expect(records).toHaveLength(CANONICAL_MODE_IDS.length);
    for (const record of records) {
      expect(record.created_at).toBe(BigInt(now));
      expect(record.updated_at).toBe(BigInt(now));
    }
  });

  it("produces ModeSchema-valid records the store can seed", () => {
    // The SQLite seed feeds these straight through modeToRow; they must parse.
    const records = canonicalModeRecords(1_700_000_000_000);
    for (const record of records) {
      expect(() => ModeSchema.parse(record)).not.toThrow();
    }
  });
});
