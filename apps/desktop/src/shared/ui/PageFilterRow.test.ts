import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./PageFilterRow.svelte", import.meta.url), "utf8");

describe("PageFilterRow", () => {
  it("exposes a pill list contract with optional count and marker", () => {
    expect(source).toMatch(/type FilterPill/);
    expect(source).toMatch(/pills: FilterPill\[\]/);
    expect(source).toMatch(/count\?: number/);
    expect(source).toMatch(/marker\?: PageFilterMarker/);
  });

  it("renders a role tablist with per-pill selection state", () => {
    expect(source).toMatch(/role="tablist"/);
    expect(source).toMatch(/role="tab"/);
    expect(source).toMatch(/aria-selected=\{active\}/);
    expect(source).toMatch(/onclick=\{\(\) => onSelect\(pill.id\)\}/);
  });

  it("renders marker-specific symbols and optional count", () => {
    expect(source).toMatch(/word-mark-\$\{pill.marker\}/);
    expect(source).toMatch(/dot dot-ok/);
    expect(source).toMatch(/pill.count !== undefined/);
  });

  it("always keeps an actions wrapper", () => {
    expect(source).toMatch(/class="page-filter-actions"/);
    expect(source).toMatch(/\{#if actions\}/);
  });
});
