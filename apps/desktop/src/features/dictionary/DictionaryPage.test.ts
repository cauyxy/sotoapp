import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./DictionaryPage.svelte", import.meta.url), "utf8");

describe("DictionaryPage redesign surface", () => {
  it("uses the shared PageHeader and page filter shell", () => {
    expect(source).toMatch(/PageHeader/);
    expect(source).toMatch(/title=\{\$t\("dictionary\.title"\)\}/);
    expect(source).not.toMatch(/vocab-cloud|dictionary-layout|editor-panel/);
    expect(source).not.toMatch(/vocab-header/);
    expect(source).not.toMatch(/vocab-add-pill|dictionary\.addWord/);
  });

  it("uses shared PageFilterRow plus expandable SearchToggle", () => {
    expect(source).toMatch(/PageFilterRow/);
    expect(source).toMatch(/SearchToggle/);
    expect(source).toMatch(/let filter/);
    expect(source).toMatch(/let query/);
    expect(source).toMatch(/dictionary\.filter/);
    expect(source).toMatch(/dictionary\.searchOpenAria/);
    expect(source).toMatch(/dictionary\.searchPlaceholder/);
    expect(source).toMatch(/word-mark-\${source}/);
  });

  it("renders read-only word cards with inline add and direct delete", () => {
    expect(source).toMatch(/type AddState/);
    expect(source).toMatch(/activateAdd/);
    expect(source).toMatch(/confirmAdd/);
    expect(source).toMatch(/deleteEntry/);
    expect(source).toMatch(/vocab-card-delete/);
    expect(source).toMatch(/dictionary\.addInput\.placeholder/);
  });

  it("does not expose legacy draft editor fields", () => {
    expect(source).not.toMatch(/createDictionaryDraft|saveDictionaryRequestFromDraft/);
    expect(source).not.toMatch(/DictionaryDraft|selectedEntryId/);
    expect(source).not.toMatch(/aliases_text|dictionary\.editor|enabledLabel|disabledLabel/);
  });

  it("maps backend dictionary sources into redesign auto/manual buckets", () => {
    expect(source).toMatch(/entrySource/);
    expect(source).toMatch(/auto_learned/);
    expect(source).toMatch(/manualCount/);
  });

  it("renders no inline status messages on the page", () => {
    expect(source).not.toMatch(/status-note/);
    expect(source).not.toMatch(/setMessage/);
  });
});
