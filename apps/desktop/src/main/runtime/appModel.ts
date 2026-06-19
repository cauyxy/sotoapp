// AppModel assembler — the single main-process seam that gathers every piece
// of UI truth into one snapshot the renderer consumes (plan §3 / §4.3). It
// reads persistence (SqliteStore), the provider catalog (@soto/core), native
// permissions, and the injected microphone enumeration, then calls the pure
// @soto/core readiness derivation. The renderer's AppResources holds the
// result; pages project from it instead of each owning a data lifecycle.
//
// Testable without Electron or the native DB binding: all sources are injected
// via AppModelDeps, so unit tests pass plain fakes (see appModel.test.ts).

import {
  deriveReadiness,
  resolveActiveProviderConfigId,
  resolveCurrentModeId,
  type AppModel,
  type AppSettings,
  type Capability,
  type CapabilityDefaults,
  type DictionaryEntry,
  type HistoryRecord,
  type MicrophoneDevice,
  type Mode,
  type PermissionStatus,
  type ProviderConfig,
  type ProviderDefaults,
  type SupportedCapability,
  type SupportedProvider,
} from "@soto/core";

// The cross-process shapes (AppModel + its leaf DTOs) are canonical in
// @soto/core; re-exported so existing main-side import sites keep resolving.
export type { AppModel, MicrophoneDevice, SupportedProvider } from "@soto/core";

/** The store reads the assembler needs — a structural subset of SqliteStore. */
export interface AppModelStore {
  getSettings(): AppSettings;
  listModes(): Mode[];
  listProviderConfigs(): ProviderConfig[];
  listRecentHistory(): HistoryRecord[];
  listDictionary(): DictionaryEntry[];
}

/** Injected sources for the assembler (wired in index.ts buildRuntime). */
export interface AppModelDeps {
  store: AppModelStore;
  listProviderDefaults(): ProviderDefaults[];
  permissionStatuses(): PermissionStatus[];
  listMicrophoneDevices(): MicrophoneDevice[] | Promise<MicrophoneDevice[]>;
  /** Whether the native bridge/facilities loaded (false = stub runtime). */
  nativeRuntimeAvailable: boolean;
}

/**
 * Map a @soto/core ProviderDefaults catalog entry into the renderer-facing
 * SupportedProvider shape, humanizing the id into a display name (e.g.
 * "doubao-ark" -> "Doubao Ark"). Single source of the catalog mapping, shared
 * with the list_supported_providers handler. Builds the per-capability map and
 * the legacy single-capability fields (omni ?? llm ?? asr) for the pre-B9
 * renderer.
 */
export function supportedProviderFromDefaults(defaults: ProviderDefaults): SupportedProvider {
  const toMenu = (cap: CapabilityDefaults): SupportedCapability => ({
    default_model: cap.defaultModel,
    models: [...cap.allowedModels],
  });
  const capabilities: Partial<Record<Capability, SupportedCapability>> = {};
  for (const [role, cap] of Object.entries(defaults.capabilities) as Array<
    [Capability, CapabilityDefaults]
  >) {
    capabilities[role] = toMenu(cap);
  }
  const legacy =
    defaults.capabilities.omni ?? defaults.capabilities.llm ?? defaults.capabilities.asr ?? null;
  return {
    provider_id: defaults.providerId,
    group: defaults.group,
    display_name: defaults.providerId
      .split("-")
      .map((part) => (part.length > 0 ? part[0]!.toUpperCase() + part.slice(1) : part))
      .join(" "),
    default_base_url: defaults.defaultBaseUrl,
    capabilities,
    default_model: legacy?.defaultModel ?? "",
    models: legacy === null ? [] : [...legacy.allowedModels],
  };
}

/** Assemble the full AppModel from injected sources. */
export async function assembleAppModel(deps: AppModelDeps): Promise<AppModel> {
  const settings = deps.store.getSettings();
  const rawModes = deps.store.listModes();
  const providerConfigs = deps.store.listProviderConfigs();
  const recentHistory = deps.store.listRecentHistory();
  const dictionary = deps.store.listDictionary();
  const modes = rawModes;
  const providerCatalog = deps.listProviderDefaults().map(supportedProviderFromDefaults);
  const permissions = deps.permissionStatuses();
  const microphones = await deps.listMicrophoneDevices();

  const activeProviderConfigId = resolveActiveProviderConfigId(settings, providerConfigs);
  const activeModeId = resolveCurrentModeId(settings, modes);

  const readiness = deriveReadiness({
    settings,
    modes,
    providerConfigs,
    permissions,
    nativeRuntimeAvailable: deps.nativeRuntimeAvailable,
  });

  return {
    settings,
    modes,
    activeModeId,
    recentHistory,
    dictionary,
    providerCatalog,
    providerConfigs,
    activeProviderConfigId,
    permissions,
    microphones,
    readiness,
  };
}
