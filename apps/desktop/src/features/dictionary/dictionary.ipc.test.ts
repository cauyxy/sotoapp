import { describe, expect, it } from "vitest";

import {
  DICTIONARY_COMMANDS,
  createDictionaryDraft,
  dictionaryEntryMatches,
  dictionaryListItem,
  saveDictionaryRequestFromDraft,
  type DictionaryEntry
} from "./dictionary.ipc";

describe("dictionary IPC model", () => {
  it("matches backend dictionary command names", () => {
    expect(DICTIONARY_COMMANDS).toEqual({
      listDictionaryEntries: "list_dictionary_entries",
      saveDictionaryEntry: "save_dictionary_entry",
      deleteDictionaryEntry: "delete_dictionary_entry"
    });
  });

  it("creates editable drafts and save requests", () => {
    const draft = createDictionaryDraft(dictionaryEntry("dict.one", "Soto", ["sotto"]));

    expect(draft).toEqual({
      id: "dict.one",
      term: "Soto",
      aliases_text: "sotto",
      note: "Product name",
      enabled: true
    });
    expect(
      saveDictionaryRequestFromDraft({
        ...draft,
        term: " Soto App ",
        aliases_text: "Soto, sotto voce\nvoice input",
        enabled: false
      })
    ).toEqual({
      id: "dict.one",
      term: "Soto App",
      aliases: ["Soto", "sotto voce", "voice input"],
      note: "Product name",
      enabled: false
    });
  });

  it("filters entries by term, alias, and note, and builds list summaries", () => {
    const soto = dictionaryEntry("dict.one", "Soto", ["sotto"]);
    const tauri = {
      ...dictionaryEntry("dict.two", "Tauri", ["desktop shell"]),
      enabled: false
    };

    expect(dictionaryEntryMatches(soto, "product")).toBe(true);
    expect(dictionaryEntryMatches(soto, "SOTTO")).toBe(true);
    expect(dictionaryEntryMatches(soto, "missing")).toBe(false);
    expect(dictionaryListItem(tauri)).toEqual({
      id: "dict.two",
      term: "Tauri",
      detail: "desktop shell",
      statusLabel: "Disabled"
    });
  });
});

function dictionaryEntry(id: string, term: string, aliases: string[]): DictionaryEntry {
  return {
    id,
    term,
    aliases,
    note: "Product name",
    source: "user_added",
    status: "active",
    enabled: true,
    created_at: "2026-05-10T00:00:00Z",
    updated_at: "2026-05-10T00:00:00Z",
    last_used_at: null,
    hit_count: 0
  };
}
