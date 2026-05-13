// Aggregated boot snapshot — a single IPC round-trip that returns the state
// the main window needs before first paint. Replaces N parallel
// `get_app_settings` / `list_modes` / `list_dictionary_entries` /
// `list_history` calls each store used to fire on its own subscribe.

import { invoke } from "@tauri-apps/api/core";

import type { AppSettings } from "./settings";
import type { HistoryRecord } from "./history";
import type { DictionaryEntry } from "../features/dictionary/dictionary.ipc";
import type { ModeRecord } from "../features/modes/modes.ipc";

export const SNAPSHOT_COMMAND = "get_app_snapshot";

export interface AppSnapshot {
  settings: AppSettings;
  modes: ModeRecord[];
  dictionary: DictionaryEntry[];
  history: HistoryRecord[];
}

export async function getAppSnapshot(): Promise<AppSnapshot> {
  return invoke<AppSnapshot>(SNAPSHOT_COMMAND);
}
