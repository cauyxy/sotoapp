import { createDataStore } from "../../shared/dataStore";
import { canonicalModeRecords, listModes, type ModeRecord } from "./modes.ipc";

async function fetchCanonicalModes(): Promise<ModeRecord[]> {
  return canonicalModeRecords(await listModes());
}

export const modesStore = createDataStore<ModeRecord[]>(fetchCanonicalModes, []);

export function refreshModes(): Promise<ModeRecord[]> {
  return modesStore.refresh();
}
