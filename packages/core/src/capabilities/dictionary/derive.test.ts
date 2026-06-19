import { describe, expect, it } from "vitest";

import type { DictionaryEntry } from "../../contract/schema.js";
import {
  dictionaryEntrySource,
  dictionaryFilterChips,
  filterDictionaryEntries,
} from "./derive.js";

function entry(over: Partial<DictionaryEntry> = {}): DictionaryEntry {
  return {
    id: "d1",
    term: "Soto",
    source: "user_added",
    hit_count: 0,
    last_used_at: null,
    created_at: 0n,
    ...over,
  };
}

describe("dictionaryEntrySource", () => {
  it("maps auto_learned → auto and user_added → manual", () => {
    expect(dictionaryEntrySource(entry({ source: "auto_learned" }))).toBe("auto");
    expect(dictionaryEntrySource(entry({ source: "user_added" }))).toBe("manual");
  });
});

describe("dictionaryFilterChips", () => {
  it("counts all / auto / manual in fixed order", () => {
    const entries = [
      entry({ id: "1", source: "user_added" }),
      entry({ id: "2", source: "auto_learned" }),
      entry({ id: "3", source: "auto_learned" }),
    ];
    expect(dictionaryFilterChips(entries)).toEqual([
      { id: "all", count: 3 },
      { id: "auto", count: 2 },
      { id: "manual", count: 1 },
    ]);
  });

  it("returns zero counts for an empty list", () => {
    expect(dictionaryFilterChips([])).toEqual([
      { id: "all", count: 0 },
      { id: "auto", count: 0 },
      { id: "manual", count: 0 },
    ]);
  });
});

describe("filterDictionaryEntries", () => {
  const entries = [
    entry({ id: "1", term: "Kafka", source: "user_added" }),
    entry({ id: "2", term: "kubernetes", source: "auto_learned" }),
    entry({ id: "3", term: "Soto", source: "user_added" }),
  ];

  it("returns everything for the 'all' filter and empty query", () => {
    expect(filterDictionaryEntries(entries, "all", "").map((e) => e.id)).toEqual(["1", "2", "3"]);
  });

  it("filters by source", () => {
    expect(filterDictionaryEntries(entries, "auto", "").map((e) => e.id)).toEqual(["2"]);
    expect(filterDictionaryEntries(entries, "manual", "").map((e) => e.id)).toEqual(["1", "3"]);
  });

  it("matches the query case-insensitively against the term", () => {
    expect(filterDictionaryEntries(entries, "all", "k").map((e) => e.id)).toEqual(["1", "2"]);
    expect(filterDictionaryEntries(entries, "all", "SOTO").map((e) => e.id)).toEqual(["3"]);
  });

  it("combines source filter and query", () => {
    expect(filterDictionaryEntries(entries, "manual", "soto").map((e) => e.id)).toEqual(["3"]);
  });

  it("ignores surrounding whitespace in the query", () => {
    expect(filterDictionaryEntries(entries, "all", "  kafka  ").map((e) => e.id)).toEqual(["1"]);
  });
});
