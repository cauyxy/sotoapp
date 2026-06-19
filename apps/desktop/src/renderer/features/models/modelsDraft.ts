// Pure draft + cascade helpers for the 模型 config-library add/edit flow
// (engine spec §7.1). Successor of the old settings/panels/providerModel.ts:
// the catalog now carries a per-capability model menu (SupportedProvider.
// capabilities), so a draft is keyed by (vendor, capability) and the helpers
// derive the model menu, credential shape, endpoint requirement, and the save
// request from that pair. No React / IPC here — a catalog slice + a draft in,
// plain data out, so the whole cascade is unit-testable without mounting.

import {
  DASHSCOPE_PROVIDER_ID,
  DASHSCOPE_REALTIME_PROVIDER_ID,
  DOUBAO_ARK_PROVIDER_ID,
  DOUBAO_ASR_PROVIDER_ID,
  MIMO_API_PROVIDER_ID,
  OPENAI_COMPAT_PROVIDER_ID,
  resolveActiveCapabilityConfigId,
  resolveActiveProviderConfigId,
  type AppSettings,
  type Capability,
  type EngineMode,
  type ProviderConfig,
  type ProviderConfigRequest,
  type SupportedProvider,
} from "@soto/core";

// Placeholder dots shown in an edit form's API-key field when a secret already
// exists (the real key is never echoed back to the renderer). Migrated here from
// the deleted useEngineConfig hook so the form is the single owner.
export const API_KEY_PLACEHOLDER_DOTS = "••••••••••••";

// Capability dot order is fixed across the UI (visual spec §2.2): omni first,
// then asr, then llm — independent of catalog declaration order.
const CAPABILITY_ORDER: readonly Capability[] = ["omni", "asr", "llm"];
const VENDOR_TILE_ORDER: readonly string[] = [
  DOUBAO_ARK_PROVIDER_ID,
  DOUBAO_ASR_PROVIDER_ID,
  DASHSCOPE_PROVIDER_ID,
  DASHSCOPE_REALTIME_PROVIDER_ID,
  MIMO_API_PROVIDER_ID,
  OPENAI_COMPAT_PROVIDER_ID,
];
const VENDOR_TILE_RANK = new Map(
  VENDOR_TILE_ORDER.map((key, index) => [key, index] as const),
);

export type CapabilityIconName = "sparkles" | "microphone" | "message";

export const CAPABILITY_META: Record<
  Capability,
  { icon: CapabilityIconName; labelKey: `models.capability.${Capability}` }
> = {
  omni: { icon: "sparkles", labelKey: "models.capability.omni" },
  asr: { icon: "microphone", labelKey: "models.capability.asr" },
  llm: { icon: "message", labelKey: "models.capability.llm" },
};

export interface VendorMeta {
  labelKey: string;
  monogram: string;
  sourceKey: string;
}

export const VENDOR_META: Record<string, VendorMeta> = {
  [MIMO_API_PROVIDER_ID]: {
    labelKey: "models.vendor.mimo",
    monogram: "Mi",
    sourceKey: "models.vendorSource.xiaomi",
  },
  "doubao-ark": {
    labelKey: "models.vendor.doubaoArk",
    monogram: "DB",
    sourceKey: "models.vendorSource.bytedance",
  },
  "doubao-asr": {
    labelKey: "models.vendor.doubaoAsr",
    monogram: "豆",
    sourceKey: "models.vendorSource.bytedance",
  },
  dashscope: {
    labelKey: "models.vendor.dashscope",
    monogram: "Q",
    sourceKey: "models.vendorSource.alibaba",
  },
  "dashscope-realtime": {
    labelKey: "models.vendor.dashscopeRealtime",
    monogram: "Q",
    sourceKey: "models.vendorSource.alibaba",
  },
  [OPENAI_COMPAT_PROVIDER_ID]: {
    labelKey: "models.vendor.openaiCompat",
    monogram: "AI",
    sourceKey: "models.vendorSource.custom",
  },
};

// Per-vendor "get an API key" console URLs (renderer-only display metadata,
// keyed by provider_id like VENDOR_META). Only vendors whose own console issues
// the credential entered in this form appear here — doubao-asr is intentionally
// absent because its App Key / Access Key pair comes from a different Volcengine
// speech console, not the Ark api-key page below. The actual open goes through
// the main process (shell.openExternal); see windows.ts hardenWindow.
const VOLCENGINE_ARK_API_KEY_URL =
  "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey";
const BAILIAN_API_KEY_URL =
  "https://bailian.console.aliyun.com/cn-beijing?tab=model#/api-key";

const VENDOR_CONSOLE_URL: Record<string, string> = {
  [DOUBAO_ARK_PROVIDER_ID]: VOLCENGINE_ARK_API_KEY_URL,
  [DASHSCOPE_PROVIDER_ID]: BAILIAN_API_KEY_URL,
  [DASHSCOPE_REALTIME_PROVIDER_ID]: BAILIAN_API_KEY_URL,
};

/** The vendor's "get an API key" console URL, or null when none is mapped. */
export function consoleUrlForProvider(providerId: string): string | null {
  return VENDOR_CONSOLE_URL[providerId] ?? null;
}

// Stable spelling overrides for known acronyms/wordmarks — this is a casing
// table, NOT a per-model alias map, so new models never require edits here.
const MODEL_ID_ACRONYMS: Record<string, string> = {
  gpt: "GPT",
  asr: "ASR",
  ai: "AI",
  llm: "LLM",
  tts: "TTS",
  omni: "Omni",
  mimo: "MiMo",
};

/**
 * Display-only prettifier for a raw catalog model id. Strips a trailing
 * release-date suffix (`-260428`), turns a dash between two digits into a dot
 * (`2-0` -> `2.0`), then titlecases each `-`/`_` token with the acronym
 * overrides above. The raw id must still be used as the Select value and in
 * every request — this is for labels only.
 */
export function prettifyModelId(id: string): string {
  const trimmed = id.trim();
  if (trimmed.length === 0) return "";
  const noDate = trimmed.replace(/-\d{6,}$/, "");
  const dotted = noDate.replace(/(\d)-(\d)/g, "$1.$2");
  return dotted
    .split(/[-_]/)
    .filter((token) => token.length > 0)
    .map((token) => {
      const override = MODEL_ID_ACRONYMS[token.toLowerCase()];
      if (override !== undefined) return override;
      return token.charAt(0).toUpperCase() + token.slice(1);
    })
    .join(" ");
}

/** Editable form state for one config (add or edit). The doubao key pair lives
 * in two extra fields; everything else mirrors a ProviderConfigRequest. */
export interface ModelConfigDraft {
  config_id: string | null;
  provider_id: string;
  capability: Capability;
  display_name: string;
  model: string;
  base_url: string;
  /** Single-secret credential (every vendor except doubao-asr). */
  api_key: string;
  /** Doubao ASR App Key (joined into api_key on save). */
  app_key: string;
  /** Doubao ASR Access Key (joined into api_key on save). */
  access_key: string;
  /** Storage-level single-default invariant; true only for the first omni config. */
  is_default: boolean;
}

/** One vendor tile in the add flow's step-1 grid. */
export interface VendorTile {
  key: string;
  provider_id: string;
  group: string | null;
  display_name: string;
  labelKey: string | null;
  monogram: string;
  /** Declared capabilities in the fixed omni→asr→llm order. */
  capabilities: Capability[];
}

export type CredentialFields = "api_key" | "doubao_pair";

function orderedCapabilities(vendor: SupportedProvider): Capability[] {
  return CAPABILITY_ORDER.filter((cap) => vendor.capabilities[cap] !== undefined);
}

function vendorKey(vendor: SupportedProvider): string {
  return vendor.group ?? vendor.provider_id;
}

function metaForVendor(vendor: SupportedProvider): VendorMeta {
  const meta = VENDOR_META[vendorKey(vendor)];
  if (meta !== undefined) return meta;
  return {
    labelKey: "",
    monogram: vendor.provider_id.slice(0, 2).toUpperCase(),
    sourceKey: "",
  };
}

function tileSeedFor(vendors: readonly SupportedProvider[]): SupportedProvider {
  return vendors[0]!;
}

function vendorTileRank(key: string): number {
  return VENDOR_TILE_RANK.get(key) ?? Number.MAX_SAFE_INTEGER;
}

/** Reshape the provider catalog into add-flow vendor tiles (cap order omni→asr→llm). */
export function vendorTiles(catalog: readonly SupportedProvider[]): VendorTile[] {
  const seen = new Set<string>();
  const tiles: VendorTile[] = [];
  for (const vendor of catalog) {
    const key = vendorKey(vendor);
    if (seen.has(key)) continue;
    seen.add(key);
    const members = catalog.filter((entry) => vendorKey(entry) === key);
    const seed = tileSeedFor(members);
    const meta = metaForVendor(seed);
    tiles.push({
      key,
      provider_id: seed.provider_id,
      group: seed.group,
      display_name: seed.display_name,
      labelKey: meta.labelKey.length > 0 ? meta.labelKey : null,
      monogram: meta.monogram,
      capabilities: orderedCapabilities(seed),
    });
  }
  return tiles
    .map((tile, index) => ({ tile, index }))
    .sort((left, right) => {
      const byRank = vendorTileRank(left.tile.key) - vendorTileRank(right.tile.key);
      return byRank !== 0 ? byRank : left.index - right.index;
    })
    .map(({ tile }) => tile);
}

export function initialCapabilityForVendor(
  vendor: SupportedProvider,
  requested: Capability | null,
): Capability {
  const available = orderedCapabilities(vendor);
  if (requested !== null && available.includes(requested)) {
    return requested;
  }
  const fallback = available[0];
  if (fallback === undefined) {
    throw new Error(`vendor ${vendor.provider_id} has no capabilities`);
  }
  return fallback;
}

/** Endpoint is a required main-form field only for arbitrary OpenAI-compatible hosts. */
export function endpointRequired(providerId: string, _group: string | null = null): boolean {
  return providerId === OPENAI_COMPAT_PROVIDER_ID;
}

/** doubao-asr authenticates with an App Key / Access Key pair; everyone else a single key. */
export function credentialFields(providerId: string): CredentialFields {
  return providerId === DOUBAO_ASR_PROVIDER_ID ? "doubao_pair" : "api_key";
}

/** Join the doubao App Key / Access Key into the single stored api_key. */
export function joinDoubaoKeys(appKey: string, accessKey: string): string {
  return `${appKey}:${accessKey}`;
}

/**
 * Seed a fresh add draft for a vendor. Missing capability falls back to the
 * vendor's first display capability (the add flow still shows the segmented pill
 * when more are available). The model is seeded from the chosen
 * capability's default, and is_default defaults true only for omni configs
 * (mirroring today's single-omni-default invariant — the caller may clear it when
 * an omni config already exists).
 */
export function createConfigDraft(
  vendor: SupportedProvider,
  capability: Capability | null,
): ModelConfigDraft {
  const available = orderedCapabilities(vendor);
  let chosen: Capability;
  if (capability !== null) {
    if (!available.includes(capability)) {
      throw new Error(`vendor ${vendor.provider_id} has no ${capability} capability`);
    }
    chosen = capability;
  } else {
    const fallback = available[0];
    if (fallback === undefined) {
      throw new Error(`vendor ${vendor.provider_id} has no capabilities`);
    }
    chosen = fallback;
  }

  const menu = vendor.capabilities[chosen];
  return {
    config_id: null,
    provider_id: vendor.provider_id,
    capability: chosen,
    display_name: "",
    model: menu?.default_model ?? "",
    base_url: "",
    api_key: "",
    app_key: "",
    access_key: "",
    is_default: chosen === "omni",
  };
}

type ActiveConfigSettings = Pick<
  AppSettings,
  "active_provider_config_id" | "active_asr_config_id" | "active_llm_config_id"
>;

export function slotKeyForCapability(
  cap: Capability,
): "active_provider_config_id" | "active_asr_config_id" | "active_llm_config_id" {
  switch (cap) {
    case "omni":
      return "active_provider_config_id";
    case "asr":
      return "active_asr_config_id";
    case "llm":
      return "active_llm_config_id";
  }
}

export function engineModeUsesCapability(mode: EngineMode, cap: Capability): boolean {
  return mode === "omni" ? cap === "omni" : cap === "asr" || cap === "llm";
}

export interface CockpitWiring {
  omni: string | null;
  asr: string | null;
  llm: string | null;
}

export function resolveCockpitWiring(
  settings: ActiveConfigSettings,
  configs: readonly ProviderConfig[],
): CockpitWiring {
  return {
    omni: resolveActiveProviderConfigId(settings, configs),
    asr: resolveActiveCapabilityConfigId(settings.active_asr_config_id, "asr", configs),
    llm: resolveActiveCapabilityConfigId(settings.active_llm_config_id, "llm", configs),
  };
}

export function isModelSwitchable(
  catalog: readonly SupportedProvider[],
  config: ProviderConfig,
): boolean {
  const vendor = catalog.find((p) => p.provider_id === config.provider_id);
  const models = vendor?.capabilities[config.capability]?.models ?? [];
  return models.length > 1;
}

/**
 * Model chips for a (vendor, capability): the capability's allowed models plus
 * the current custom value appended when it is not already in the menu (mirrors
 * the old recommendedModelsFor). An unknown vendor/capability yields just the
 * custom value (so a hand-typed model is never lost).
 */
export function modelChips(
  catalog: readonly SupportedProvider[],
  providerId: string,
  capability: Capability,
  currentModel: string,
): string[] {
  const vendor = catalog.find((p) => p.provider_id === providerId);
  const menu = vendor?.capabilities[capability]?.models ?? [];
  const chips = [...menu];
  const custom = currentModel.trim();
  if (custom.length > 0 && !chips.includes(custom)) {
    chips.push(custom);
  }
  return chips;
}

function optionalValue(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Build the save request from a draft: carries the capability, joins a doubao
 * key pair into api_key, blanks an empty credential to null (keep-existing on
 * edit), and keeps is_default true only for omni configs.
 */
export function saveRequestFromDraft(
  draft: ModelConfigDraft,
): ProviderConfigRequest & { config_id: string | null } {
  const apiKey =
    credentialFields(draft.provider_id) === "doubao_pair"
      ? draft.app_key.trim().length > 0 || draft.access_key.trim().length > 0
        ? joinDoubaoKeys(draft.app_key.trim(), draft.access_key.trim())
        : null
      : optionalValue(draft.api_key);

  return {
    config_id: draft.config_id,
    provider_id: draft.provider_id.trim(),
    display_name: optionalValue(draft.display_name),
    model: draft.model.trim(),
    base_url: optionalValue(draft.base_url),
    api_key: apiKey,
    is_default: draft.capability === "omni" ? draft.is_default : false,
    capability: draft.capability,
  };
}

/** Seed an edit draft from a persisted config: the vendor + capability are
 * fixed, the api_key starts blank (never echoed; a blank save keeps the secret),
 * and null base_url/display_name map to empty strings. */
export function draftFromConfig(config: ProviderConfig): ModelConfigDraft {
  return {
    config_id: config.config_id,
    provider_id: config.provider_id,
    capability: config.capability,
    display_name: config.display_name ?? "",
    model: config.model,
    base_url: config.base_url ?? "",
    api_key: "",
    app_key: "",
    access_key: "",
    is_default: config.is_default,
  };
}
