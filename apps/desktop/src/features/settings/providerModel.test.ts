import { describe, expect, it } from "vitest";

import type { ProviderCatalog, ProviderConfigDraft } from "../../ipc/providers";
import {
  recommendedModelsFor,
  updateDraftProvider,
  validateModelInput
} from "./providerModel";

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

describe("provider model draft behavior", () => {
  it("fills doubao lite when switching from an automatic model", () => {
    const next = updateDraftProvider(draft({ model: "mimo-v2.5" }), catalog, "doubao-ark");

    expect(next.provider_id).toBe("doubao-ark");
    expect(next.model).toBe("doubao-seed-2-0-lite-260428");
    expect(next.base_url).toBe("");
  });

  it("preserves a custom model when switching providers", () => {
    const next = updateDraftProvider(
      draft({ model: "custom-audio-model" }),
      catalog,
      "doubao-ark"
    );

    expect(next.model).toBe("custom-audio-model");
  });

  it("returns recommended models without dropping custom draft values", () => {
    expect(recommendedModelsFor(catalog, "doubao-ark", "custom-audio-model")).toEqual([
      "doubao-seed-2-0-lite-260428",
      "doubao-seed-2-0-mini-260428",
      "custom-audio-model"
    ]);
  });

  it("reports blank model input as invalid", () => {
    expect(validateModelInput("   ")).toEqual({ ok: false, reason: "required" });
    expect(validateModelInput("doubao-seed-2-0-lite-260428")).toEqual({ ok: true });
  });
});

function draft(overrides: Partial<ProviderConfigDraft> = {}): ProviderConfigDraft {
  return {
    config_id: null,
    provider_id: "mimo-plan-sea",
    display_name: "",
    model: "mimo-v2.5",
    base_url: "",
    api_key: "",
    is_default: true,
    ...overrides
  };
}
