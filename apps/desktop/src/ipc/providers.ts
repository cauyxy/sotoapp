import { invoke } from "@tauri-apps/api/core";

export const PROVIDER_COMMANDS = {
  listProviderConfigs: "list_provider_configs",
  createProviderConfig: "create_provider_config",
  saveProviderConfig: "save_provider_config",
  setDefaultProviderConfig: "set_default_provider_config",
  testProviderConfig: "test_provider_config",
  listSupportedProviders: "list_supported_providers"
} as const;

export type ValidationStatus = "unspecified" | "ok" | "warn" | "err";

export interface SupportedProvider {
  provider_id: string;
  display_name: string;
  default_endpoint: string | null;
  default_model: string | null;
  requires_app_id: boolean;
  suggested_models: string[];
}

export interface ProviderCatalog {
  providers: SupportedProvider[];
}

export interface ProviderConfigValidation {
  last_validated_at: string | null;
  last_validated_latency_ms: number | null;
  last_validated_status: ValidationStatus;
  last_validated_note: string | null;
  last_validated_sample: string | null;
  last_validated_sample_result: string | null;
}

export interface ProviderConfig {
  config_id: string;
  provider_id: string;
  display_name: string | null;
  model: string;
  base_url: string | null;
  is_default: boolean;
  validation: ProviderConfigValidation;
  created_at: string;
  updated_at: string;
}

export interface CreateProviderConfigRequest {
  provider_id: string;
  display_name: string | null;
  model: string;
  base_url: string | null;
  api_key: string | null;
  is_default: boolean;
}

export interface SaveProviderConfigRequest extends CreateProviderConfigRequest {
  config_id: string | null;
}

export interface ProviderConfigDraft {
  config_id: string | null;
  provider_id: string;
  display_name: string;
  model: string;
  base_url: string;
  api_key: string;
  is_default: boolean;
}

export interface TestProviderRequest {
  config_id: string;
  sample: string | null;
}

export interface ProviderTestResult {
  config_id: string;
  status: ValidationStatus;
  note: string;
  latency_ms: number;
}

export function providerDisplayName(config: ProviderConfig): string {
  return config.display_name || `${config.provider_id} · ${config.model}`;
}

export function createProviderDraft(config: ProviderConfig): ProviderConfigDraft {
  return {
    config_id: config.config_id,
    provider_id: config.provider_id,
    display_name: config.display_name ?? "",
    model: config.model,
    base_url: config.base_url ?? "",
    api_key: "",
    is_default: config.is_default
  };
}

export function createNewProviderDraft(isDefault: boolean): ProviderConfigDraft {
  return {
    config_id: null,
    provider_id: "mimo-plan-sea",
    display_name: "Mimo-Plan-SEA",
    model: "mimo-v2.5",
    base_url: "",
    api_key: "",
    is_default: isDefault
  };
}

export function saveProviderConfigRequestFromDraft(
  draft: ProviderConfigDraft
): SaveProviderConfigRequest {
  return {
    config_id: draft.config_id,
    provider_id: requiredValue(draft.provider_id),
    display_name: optionalValue(draft.display_name),
    model: requiredValue(draft.model),
    base_url: optionalValue(draft.base_url),
    api_key: optionalValue(draft.api_key),
    is_default: draft.is_default
  };
}

export async function listSupportedProviders(): Promise<ProviderCatalog> {
  return invoke(PROVIDER_COMMANDS.listSupportedProviders);
}

export function findProviderMeta(
  catalog: ProviderCatalog,
  providerId: string
): SupportedProvider | null {
  return catalog.providers.find((provider) => provider.provider_id === providerId) ?? null;
}

export function defaultEndpointFor(
  catalog: ProviderCatalog,
  providerId: string
): string | null {
  return findProviderMeta(catalog, providerId)?.default_endpoint ?? null;
}

export async function listProviderConfigs(): Promise<ProviderConfig[]> {
  return invoke(PROVIDER_COMMANDS.listProviderConfigs);
}

export async function createProviderConfig(
  request: CreateProviderConfigRequest
): Promise<ProviderConfig> {
  return invoke(PROVIDER_COMMANDS.createProviderConfig, { request });
}

export async function saveProviderConfig(
  request: SaveProviderConfigRequest
): Promise<ProviderConfig> {
  return invoke(PROVIDER_COMMANDS.saveProviderConfig, { request });
}

export async function setDefaultProviderConfig(configId: string): Promise<void> {
  return invoke(PROVIDER_COMMANDS.setDefaultProviderConfig, { configId });
}

export async function testProviderConfig(
  request: TestProviderRequest
): Promise<ProviderTestResult> {
  return invoke(PROVIDER_COMMANDS.testProviderConfig, { request });
}

function optionalValue(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requiredValue(value: string): string {
  return value.trim();
}
