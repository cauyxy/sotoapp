// Dictionary derivation — pure filter/chip shaping over dictionary entries,
// moved out of the renderer DictionaryPage so the source classification, filter
// chips, and term matching live alongside the other @soto/core capabilities and
// are unit-tested in Node (plan §4.9). Data-in/data-out: no React, no IO. When
// History-derived candidate words land later, that derivation joins here too —
// the page never re-implements string rules.

import type { DictionaryEntry } from "../../contract/schema.js";

export type DictionaryFilter = "all" | "auto" | "manual";
export type DictionarySourceKind = "auto" | "manual";

/** Classify an entry's provenance into the UI's two source buckets. */
export function dictionaryEntrySource(entry: Pick<DictionaryEntry, "source">): DictionarySourceKind {
  return entry.source === "auto_learned" ? "auto" : "manual";
}

export interface DictionaryFilterChip {
  id: DictionaryFilter;
  count: number;
}

/** The all/auto/manual filter chips with counts, in fixed display order. */
export function dictionaryFilterChips(
  entries: readonly DictionaryEntry[],
): DictionaryFilterChip[] {
  let auto = 0;
  for (const entry of entries) {
    if (dictionaryEntrySource(entry) === "auto") auto += 1;
  }
  const total = entries.length;
  return [
    { id: "all", count: total },
    { id: "auto", count: auto },
    { id: "manual", count: total - auto },
  ];
}

/** Filter entries by source bucket + a case-insensitive term query. */
export function filterDictionaryEntries(
  entries: readonly DictionaryEntry[],
  filter: DictionaryFilter,
  query: string,
): DictionaryEntry[] {
  const normalized = query.trim().toLowerCase();
  return entries.filter((entry) => {
    if (filter !== "all" && dictionaryEntrySource(entry) !== filter) return false;
    if (normalized.length > 0 && !entry.term.toLowerCase().includes(normalized)) return false;
    return true;
  });
}
