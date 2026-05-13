import { describe, expect, it } from "vitest";

import {
  PROVIDER_COMMANDS,
  createProviderDraft,
  createNewProviderDraft,
  defaultEndpointFor,
  providerDisplayName,
  saveProviderConfigRequestFromDraft,
  type ProviderCatalog,
  type ProviderConfig
} from "./providers";

describe("provider IPC model", () => {
  it("matches the backend provider command names", () => {
    expect(PROVIDER_COMMANDS).toEqual({
      listProviderConfigs: "list_provider_configs",
      createProviderConfig: "create_provider_config",
      saveProviderConfig: "save_provider_config",
      setDefaultProviderConfig: "set_default_provider_config",
      testProviderConfig: "test_provider_config",
      listSupportedProviders: "list_supported_providers"
    });
  });

  it("finds a provider default endpoint and falls back to null", () => {
    const catalog: ProviderCatalog = {
      providers: [
        {
          provider_id: "mimo-plan-sea",
          display_name: "Mimo-Plan-SEA",
          default_endpoint: "https://token-plan-sgp.xiaomimimo.com/v1",
          default_model: "mimo-v2.5",
          requires_app_id: false,
          suggested_models: ["mimo-v2.5"]
        },
        {
          provider_id: "doubao-ark",
          display_name: "Doubao Ark",
          default_endpoint: "https://ark.cn-beijing.volces.com/api/v3",
          default_model: "doubao-seed-2-0-lite-260428",
          requires_app_id: false,
          suggested_models: [
            "doubao-seed-2-0-lite-260428",
            "doubao-seed-2-0-mini-260428"
          ]
        }
      ]
    };

    expect(defaultEndpointFor(catalog, "mimo-plan-sea")).toBe(
      "https://token-plan-sgp.xiaomimimo.com/v1"
    );
    expect(defaultEndpointFor(catalog, "doubao-ark")).toBe(
      "https://ark.cn-beijing.volces.com/api/v3"
    );
    expect(defaultEndpointFor(catalog, "unknown")).toBeNull();
  });

  it("uses display names without exposing secrets", () => {
    expect(providerDisplayName(omniConfig())).toBe("Mimo-Plan-SEA");
    expect(JSON.stringify(omniConfig())).not.toContain("secret");
  });

  it("creates edit drafts without reading provider secrets back into the UI", () => {
    expect(createProviderDraft(omniConfig())).toMatchObject({
      config_id: "config.omni",
      provider_id: "mimo-plan-sea",
      model: "mimo-v2.5",
      base_url: "https://token-plan-sgp.xiaomimimo.com/v1",
      api_key: "",
      is_default: true
    });
  });

  it("leaves new endpoint fields blank so provider defaults can be shown as placeholders", () => {
    expect(createNewProviderDraft(true).base_url).toBe("");
  });

  it("maps drafts to save requests and treats blank secret fields as preserve-existing", () => {
    expect(
      saveProviderConfigRequestFromDraft({
        config_id: "config.omni",
        provider_id: " mimo-plan-sea ",
        display_name: "",
        model: " mimo-v2.5 ",
        base_url: "",
        api_key: " omni-key ",
        is_default: true
      })
    ).toEqual({
      config_id: "config.omni",
      provider_id: "mimo-plan-sea",
      display_name: null,
      model: "mimo-v2.5",
      base_url: null,
      api_key: "omni-key",
      is_default: true
    });
  });
});

function omniConfig({
  configId = "config.omni",
  isDefault = true,
  status = "unspecified"
}: {
  configId?: string;
  isDefault?: boolean;
  status?: ProviderConfig["validation"]["last_validated_status"];
} = {}): ProviderConfig {
  return {
    config_id: configId,
    provider_id: "mimo-plan-sea",
    display_name: "Mimo-Plan-SEA",
    model: "mimo-v2.5",
    base_url: "https://token-plan-sgp.xiaomimimo.com/v1",
    is_default: isDefault,
    validation: {
      last_validated_at: null,
      last_validated_latency_ms: null,
      last_validated_status: status,
      last_validated_note: null,
      last_validated_sample: null,
      last_validated_sample_result: null
    },
    created_at: "2026-05-10T00:00:00Z",
    updated_at: "2026-05-10T00:00:00Z"
  };
}
