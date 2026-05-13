import { invoke } from "@tauri-apps/api/core";

export const DICTIONARY_COMMANDS = {
  listDictionaryEntries: "list_dictionary_entries",
  saveDictionaryEntry: "save_dictionary_entry",
  deleteDictionaryEntry: "delete_dictionary_entry"
} as const;

export type DictionarySource = "user_added" | "auto_learned";
export type DictionaryStatus = "active" | "suggested" | "archived";

export interface DictionaryEntry {
  id: string;
  term: string;
  aliases: string[];
  note: string;
  source: DictionarySource;
  status: DictionaryStatus;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  hit_count: number;
}

export interface DictionaryDraft {
  id: string | null;
  term: string;
  aliases_text: string;
  note: string;
  enabled: boolean;
}

export interface SaveDictionaryEntryRequest {
  id: string | null;
  term: string;
  aliases: string[];
  note: string;
  enabled: boolean;
}

export interface DictionaryListItem {
  id: string;
  term: string;
  detail: string;
  statusLabel: string;
}

export function createDictionaryDraft(entry?: DictionaryEntry): DictionaryDraft {
  return {
    id: entry?.id ?? null,
    term: entry?.term ?? "",
    aliases_text: entry?.aliases.join(", ") ?? "",
    note: entry?.note ?? "",
    enabled: entry?.enabled ?? true
  };
}

export function saveDictionaryRequestFromDraft(
  draft: DictionaryDraft
): SaveDictionaryEntryRequest {
  return {
    id: draft.id,
    term: draft.term.trim(),
    aliases: splitAliases(draft.aliases_text),
    note: draft.note.trim(),
    enabled: draft.enabled
  };
}

export function dictionaryEntryMatches(entry: DictionaryEntry, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;

  return [entry.term, entry.aliases.join("\n"), entry.note]
    .join("\n")
    .toLowerCase()
    .includes(normalized);
}

export function dictionaryListItem(entry: DictionaryEntry): DictionaryListItem {
  return {
    id: entry.id,
    term: entry.term,
    detail: entry.aliases.length > 0 ? entry.aliases.join(", ") : entry.note || "No aliases",
    statusLabel: entry.enabled ? statusLabel(entry.status) : "Disabled"
  };
}

export async function listDictionaryEntries(): Promise<DictionaryEntry[]> {
  return invoke(DICTIONARY_COMMANDS.listDictionaryEntries);
}

export async function saveDictionaryEntry(
  request: SaveDictionaryEntryRequest
): Promise<DictionaryEntry> {
  return invoke(DICTIONARY_COMMANDS.saveDictionaryEntry, { request });
}

export async function deleteDictionaryEntry(entryId: string): Promise<void> {
  return invoke(DICTIONARY_COMMANDS.deleteDictionaryEntry, { entryId });
}

function splitAliases(value: string): string[] {
  return value
    .split(/[\n,]/u)
    .map((alias) => alias.trim())
    .filter(Boolean);
}

function statusLabel(status: DictionaryStatus): string {
  if (status === "active") return "Active";
  if (status === "suggested") return "Suggested";
  return "Archived";
}
