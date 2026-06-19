// The aggregated AppModel — the one-shot fact bundle `get_app_model` returns
// to the main window. This is the canonical cross-process shape: the main
// assembler (apps/desktop appModel.ts) produces it and the renderer's
// AppResources holds it; neither side re-declares the type. It lives in
// capabilities (not contract) because it composes the AppReadiness judgement,
// which contract — a lower layer — must not import.

import type {
  AppSettings,
  DictionaryEntry,
  HistoryRecord,
  Mode,
  ProviderConfig,
} from "../../contract/schema.js";
import type {
  MicrophoneDevice,
  PermissionStatus,
  SupportedProvider,
} from "../../contract/outputs.js";
import type { AppReadiness } from "./readiness.js";

/**
 * Not a renderer cache: after a mutation, AppResources.refresh() re-pulls the
 * model. `readiness` is the pure judgement; `activeModeId` /
 * `activeProviderConfigId` use the same resolvers readiness does, so they
 * never disagree.
 */
export interface AppModel {
  settings: AppSettings;
  modes: Mode[];
  activeModeId: string | null;
  recentHistory: HistoryRecord[];
  dictionary: DictionaryEntry[];
  providerCatalog: SupportedProvider[];
  providerConfigs: ProviderConfig[];
  activeProviderConfigId: string | null;
  permissions: PermissionStatus[];
  microphones: MicrophoneDevice[];
  readiness: AppReadiness;
}
