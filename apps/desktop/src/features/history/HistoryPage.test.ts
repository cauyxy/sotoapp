import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./HistoryPage.svelte", import.meta.url), "utf8");
const en = readFileSync(new URL("../../i18n/locales/en-US.ts", import.meta.url), "utf8");
const zh = readFileSync(new URL("../../i18n/locales/zh-CN.ts", import.meta.url), "utf8");

describe("HistoryPage redesign surface", () => {
  it("does not render the retired stats header or destructive toolbar actions", () => {
    expect(source).not.toMatch(/historyHeaderStats/);
    expect(source).not.toMatch(/history-stats/);
    expect(source).not.toMatch(/clearAllHistory|clearHistory|deleteHistoryRecord/);
    expect(source).not.toMatch(/history\.refresh|history\.clearAll|common\.delete/);
  });

  it("uses the shared page filter row with mode count pills", () => {
    expect(source).toMatch(/PageFilterRow/);
    expect(source).toMatch(/SearchToggle/);
    expect(source).toMatch(/filterPills/);
    expect(source).toMatch(/let filterId/);
    expect(source).toMatch(/onSelect=\{\(id\) => \(filterId = id\)\}/);
    expect(source).not.toMatch(/history-toolbar|chip-row|history-chip/);
  });

  it("keeps the filter actions to search without the retired final-only toggle", () => {
    expect(source).not.toMatch(/onlyFinal/);
    expect(source).not.toMatch(/page-filter-toggle/);
    expect(source).not.toMatch(/aria-pressed/);
    expect(source).not.toMatch(/history\.toolbar\.onlyFinal/);
    expect(source).toMatch(/history\.searchAria/);
    expect(source).toMatch(/history\.searchPlaceholder/);
    expect(source).not.toMatch(/page-filter-search-open/);
    expect(source).not.toMatch(/history\.toolbar\.multiSelect|history\.export/);
    expect(source).not.toMatch(/history\.multiSelectComingSoon|history\.exportComingSoon/);
  });

  it("uses link-style Copy row action without an engine meta column", () => {
    expect(source).toMatch(/class="history-link"/);
    expect(source).not.toMatch(/regenerateRecord/);
    expect(source).not.toMatch(/history\.regenerate/);
    expect(source).not.toMatch(/row\.engine/);
  });

  it("shows raw transcript blocks whenever a row has raw text", () => {
    expect(source).toMatch(/row\.raw/);
    expect(source).not.toMatch(/row\.raw &&/);
  });

  it("removes retired placeholder and final-only locale keys", () => {
    for (const locale of [en, zh]) {
      expect(locale).not.toMatch(/onlyFinal/);
      expect(locale).not.toMatch(/multiSelect/);
      expect(locale).not.toMatch(/exportComingSoon/);
      expect(locale).not.toMatch(/multiSelectComingSoon/);
    }
  });

  it("renders no inline status messages on the page", () => {
    expect(source).not.toMatch(/status-note/);
    expect(source).not.toMatch(/setMessage/);
  });
});
