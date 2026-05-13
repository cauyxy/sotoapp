import { createDataStore } from "../../shared/dataStore";
import { listDictionaryEntries, type DictionaryEntry } from "./dictionary.ipc";

export const dictionaryStore = createDataStore<DictionaryEntry[]>(
  listDictionaryEntries,
  []
);

export function refreshDictionaryEntries(): Promise<DictionaryEntry[]> {
  return dictionaryStore.refresh();
}
