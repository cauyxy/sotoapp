import { createDataStore } from "../shared/dataStore";
import { listHistory, type HistoryRecord } from "./history";

export const historyStore = createDataStore<HistoryRecord[]>(listHistory, []);

export function refreshHistoryRecords(): Promise<HistoryRecord[]> {
  return historyStore.refresh();
}
