import { describe, expect, it } from "vitest";

import type { Capability, ProviderConfig, SupportedProvider } from "@soto/core";

import {
  CAPABILITY_META,
  consoleUrlForProvider,
  createConfigDraft,
  credentialFields,
  draftFromConfig,
  endpointRequired,
  engineModeUsesCapability,
  initialCapabilityForVendor,
  isModelSwitchable,
  joinDoubaoKeys,
  modelChips,
  prettifyModelId,
  resolveCockpitWiring,
  saveRequestFromDraft,
  slotKeyForCapability,
  VENDOR_META,
  vendorTiles,
  type ModelConfigDraft,
} from "./modelsDraft";

// A minimal slice of the providerCatalog (model.providerCatalog) covering the
// capability shapes: dual omni+llm (mimo/dashscope), asr+llm (openai-compat),
// and standalone asr providers. Display names + capability menus mirror what main's
// supportedProviderFromDefaults emits.
const CATALOG: SupportedProvider[] = [
  {
    provider_id: "mimo-api",
    group: null,
    display_name: "Mimo Api",
    default_base_url: "https://api.xiaomimimo.com/v1",
    capabilities: {
      omni: { default_model: "mimo-v2.5", models: ["mimo-v2.5"] },
      llm: { default_model: "mimo-v2.5", models: ["mimo-v2.5"] },
    },
    default_model: "mimo-v2.5",
    models: ["mimo-v2.5"],
  },
  {
    provider_id: "dashscope",
    group: null,
    display_name: "Dashscope",
    default_base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    capabilities: {
      omni: { default_model: "qwen3.5-omni-flash", models: ["qwen3.5-omni-flash"] },
      llm: { default_model: "qwen3.5-omni-flash", models: ["qwen3.5-omni-flash"] },
    },
    default_model: "qwen3.5-omni-flash",
    models: ["qwen3.5-omni-flash"],
  },
  {
    provider_id: "dashscope-realtime",
    group: null,
    display_name: "Dashscope Realtime",
    default_base_url: "wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
    capabilities: {
      asr: {
        default_model: "qwen3-asr-flash-realtime",
        models: [
          "qwen3-asr-flash-realtime",
          "qwen3.5-omni-flash-realtime",
          "qwen3.5-omni-plus-realtime",
        ],
      },
    },
    default_model: "qwen3-asr-flash-realtime",
    models: [
      "qwen3-asr-flash-realtime",
      "qwen3.5-omni-flash-realtime",
      "qwen3.5-omni-plus-realtime",
    ],
  },
  {
    provider_id: "openai-compat",
    group: null,
    display_name: "Openai Compat",
    default_base_url: "https://api.openai.com/v1",
    capabilities: {
      asr: {
        default_model: "whisper-1",
        models: ["whisper-1", "gpt-4o-transcribe"],
      },
      llm: { default_model: "gpt-4o-mini", models: ["gpt-4o-mini", "gpt-4o"] },
    },
    default_model: "whisper-1",
    models: ["whisper-1", "gpt-4o-transcribe"],
  },
  {
    provider_id: "doubao-asr",
    group: null,
    display_name: "Doubao Asr",
    default_base_url: "https://openspeech.bytedance.com",
    capabilities: {
      asr: { default_model: "bigmodel", models: ["bigmodel"] },
    },
    default_model: "bigmodel",
    models: ["bigmodel"],
  },
  {
    provider_id: "doubao-ark",
    group: null,
    display_name: "Doubao Ark",
    default_base_url: "https://ark.cn-beijing.volces.com/api/v3",
    capabilities: {
      omni: {
        default_model: "doubao-seed-2-0-lite-260428",
        models: ["doubao-seed-2-0-lite-260428"],
      },
      llm: {
        default_model: "doubao-seed-2-0-lite-260428",
        models: ["doubao-seed-2-0-lite-260428"],
      },
    },
    default_model: "doubao-seed-2-0-lite-260428",
    models: ["doubao-seed-2-0-lite-260428"],
  },
];

function findVendor(providerId: string): SupportedProvider {
  const vendor = CATALOG.find((p) => p.provider_id === providerId);
  if (!vendor) throw new Error(`test vendor missing: ${providerId}`);
  return vendor;
}

function cfg(id: string, capability: Capability, isDefault = false): ProviderConfig {
  return {
    config_id: id,
    provider_id: "p",
    capability,
    display_name: null,
    model: "m",
    base_url: null,
    is_default: isDefault,
    validation: {
      last_validated_status: "ok",
      last_validated_at: null,
      last_validated_latency_ms: 1,
      last_validated_note: null,
      last_validated_sample: null,
      last_validated_sample_result: null,
    },
    created_at: 1n,
    updated_at: 1n,
  };
}

const baseSettings = {
  active_provider_config_id: null,
  active_asr_config_id: null,
  active_llm_config_id: null,
};

describe("slotKeyForCapability", () => {
  it("maps each capability to its settings key", () => {
    expect(slotKeyForCapability("omni")).toBe("active_provider_config_id");
    expect(slotKeyForCapability("asr")).toBe("active_asr_config_id");
    expect(slotKeyForCapability("llm")).toBe("active_llm_config_id");
  });
});

describe("engineModeUsesCapability", () => {
  it("omni mode uses only omni; asr_llm uses asr and llm", () => {
    expect(engineModeUsesCapability("omni", "omni")).toBe(true);
    expect(engineModeUsesCapability("omni", "asr")).toBe(false);
    expect(engineModeUsesCapability("asr_llm", "asr")).toBe(true);
    expect(engineModeUsesCapability("asr_llm", "llm")).toBe(true);
    expect(engineModeUsesCapability("asr_llm", "omni")).toBe(false);
  });
});

describe("resolveCockpitWiring", () => {
  it("resolves omni via is_default fallback when no explicit selection", () => {
    const configs = [cfg("o1", "omni", true), cfg("a1", "asr")];
    expect(resolveCockpitWiring(baseSettings, configs).omni).toBe("o1");
  });

  it("does not ring a slot whose active id points at a wrong-capability config", () => {
    const configs = [cfg("o1", "omni", true)];
    const settings = { ...baseSettings, active_llm_config_id: "o1" };
    expect(resolveCockpitWiring(settings, configs).llm).toBeNull();
  });

  it("resolves explicit asr selection strictly", () => {
    const configs = [cfg("a1", "asr"), cfg("a2", "asr")];
    const settings = { ...baseSettings, active_asr_config_id: "a2" };
    const wiring = resolveCockpitWiring(settings, configs);
    expect(wiring.asr).toBe("a2");
    expect(wiring.omni).toBeNull();
  });
});

describe("vendorTiles", () => {
  it("sorts known vendor tiles into the display order", () => {
    const tiles = vendorTiles(CATALOG);
    expect(tiles.map((tile) => tile.provider_id)).toEqual([
      "doubao-ark",
      "doubao-asr",
      "dashscope",
      "dashscope-realtime",
      "mimo-api",
      "openai-compat",
    ]);
    expect(tiles[4]).toMatchObject({
      key: "mimo-api",
      group: null,
      provider_id: "mimo-api",
      labelKey: "models.vendor.mimo",
      monogram: "Mi",
      capabilities: ["omni", "llm"],
    });
  });

  it("keeps ungrouped vendors one-to-one with capabilities in omni→asr→llm order", () => {
    const tiles = vendorTiles(CATALOG);
    const byProvider = new Map(tiles.map((tile) => [tile.provider_id, tile]));
    // openai-compat declares llm before asr in the map — tiles re-order it.
    expect(byProvider.get("openai-compat")!.capabilities).toEqual(["asr", "llm"]);
    expect(byProvider.get("doubao-asr")!.capabilities).toEqual(["asr"]);
    expect(byProvider.get("dashscope-realtime")).toMatchObject({
      key: "dashscope-realtime",
      group: null,
      labelKey: "models.vendor.dashscopeRealtime",
      monogram: "Q",
      capabilities: ["asr"],
    });
  });
});

describe("CAPABILITY_META", () => {
  it("covers every supported capability with an icon and translation key", () => {
    expect(Object.keys(CAPABILITY_META).sort()).toEqual(["asr", "llm", "omni"]);
    expect(CAPABILITY_META.omni).toMatchObject({
      icon: "sparkles",
      labelKey: "models.capability.omni",
    });
    expect(CAPABILITY_META.asr).toMatchObject({
      icon: "microphone",
      labelKey: "models.capability.asr",
    });
    expect(CAPABILITY_META.llm).toMatchObject({
      icon: "message",
      labelKey: "models.capability.llm",
    });
  });
});

describe("VENDOR_META", () => {
  it("keeps renderer-owned display metadata out of the core catalog", () => {
    expect(VENDOR_META["mimo-api"]).toMatchObject({
      labelKey: "models.vendor.mimo",
      monogram: "Mi",
    });
    expect(VENDOR_META.dashscope).toMatchObject({
      labelKey: "models.vendor.dashscope",
      monogram: "Q",
    });
    expect(VENDOR_META["dashscope-realtime"]).toMatchObject({
      labelKey: "models.vendor.dashscopeRealtime",
      monogram: "Q",
    });
  });
});

describe("createConfigDraft", () => {
  it("auto-picks the sole capability of a single-capability vendor", () => {
    const draft = createConfigDraft(findVendor("doubao-asr"), null);
    expect(draft.capability).toBe("asr");
    expect(draft.provider_id).toBe("doubao-asr");
    expect(draft.model).toBe("bigmodel");
    expect(draft.base_url).toBe("");
    expect(draft.display_name).toBe("");
    expect(draft.api_key).toBe("");
    expect(draft.config_id).toBeNull();
  });

  it("requires an explicit capability for a multi-capability vendor and seeds its default model", () => {
    const draft = createConfigDraft(findVendor("openai-compat"), "llm");
    expect(draft.capability).toBe("llm");
    expect(draft.model).toBe("gpt-4o-mini");
  });

  it("falls back to the first display capability when a multi-capability vendor has no explicit capability", () => {
    const draft = createConfigDraft(findVendor("mimo-api"), null);
    expect(draft.capability).toBe("omni");
    expect(draft.model).toBe("mimo-v2.5");
  });

  it("seeds is_default true only for the first omni config", () => {
    const omni = createConfigDraft(findVendor("mimo-api"), "omni");
    expect(omni.is_default).toBe(true);
    const asr = createConfigDraft(findVendor("openai-compat"), "asr");
    expect(asr.is_default).toBe(false);
  });

  it("seeds base_url empty for openai-compat (endpoint required, filled by the user)", () => {
    const draft = createConfigDraft(findVendor("openai-compat"), "asr");
    expect(draft.base_url).toBe("");
  });

  it("seeds the realtime Qwen ASR model from its standalone tile", () => {
    const draft = createConfigDraft(findVendor("dashscope-realtime"), null);
    expect(draft.provider_id).toBe("dashscope-realtime");
    expect(draft.capability).toBe("asr");
    expect(draft.model).toBe("qwen3-asr-flash-realtime");
    expect(draft.base_url).toBe("");
  });

  it("leaves the MiMo endpoint blank so the catalog default stays advanced", () => {
    const draft = createConfigDraft(findVendor("mimo-api"), "omni");
    expect(draft.base_url).toBe("");
  });
});

describe("initialCapabilityForVendor", () => {
  it("uses the requested capability when the vendor supports it", () => {
    expect(initialCapabilityForVendor(findVendor("openai-compat"), "llm")).toBe("llm");
  });

  it("falls back to the first display capability for generic add flow picks", () => {
    expect(initialCapabilityForVendor(findVendor("mimo-api"), null)).toBe("omni");
    expect(initialCapabilityForVendor(findVendor("openai-compat"), "omni")).toBe("asr");
  });
});

describe("modelChips", () => {
  it("returns the capability's allowed models", () => {
    expect(modelChips(CATALOG, "openai-compat", "asr", "whisper-1")).toEqual([
      "whisper-1",
      "gpt-4o-transcribe",
    ]);
  });

  it("appends a custom current model not already in the menu", () => {
    expect(modelChips(CATALOG, "openai-compat", "asr", "my-local-whisper")).toEqual([
      "whisper-1",
      "gpt-4o-transcribe",
      "my-local-whisper",
    ]);
  });

  it("does not duplicate a current model already in the menu", () => {
    expect(modelChips(CATALOG, "openai-compat", "asr", "gpt-4o-transcribe")).toEqual([
      "whisper-1",
      "gpt-4o-transcribe",
    ]);
  });

  it("returns just the custom model when the vendor/capability is unknown", () => {
    expect(modelChips(CATALOG, "nope", "asr", "x")).toEqual(["x"]);
    expect(modelChips(CATALOG, "openai-compat", "omni", "")).toEqual([]);
  });
});

describe("credentialFields", () => {
  it("uses a doubao key pair only for doubao-asr", () => {
    expect(credentialFields("doubao-asr")).toBe("doubao_pair");
    expect(credentialFields("openai-compat")).toBe("api_key");
    expect(credentialFields("mimo-api")).toBe("api_key");
  });
});

describe("joinDoubaoKeys", () => {
  it("joins App Key and Access Key with a colon", () => {
    expect(joinDoubaoKeys("app", "secret")).toBe("app:secret");
  });
});

describe("endpointRequired", () => {
  it("is true only for arbitrary OpenAI-compatible endpoints", () => {
    expect(endpointRequired("openai-compat", null)).toBe(true);
    expect(endpointRequired("mimo-api", null)).toBe(false);
    expect(endpointRequired("doubao-asr", null)).toBe(false);
    expect(endpointRequired("dashscope-realtime", null)).toBe(false);
  });
});

describe("isModelSwitchable", () => {
  function config(overrides: Partial<ProviderConfig>): ProviderConfig {
    return {
      config_id: "cfg-1",
      provider_id: "openai-compat",
      display_name: null,
      model: "whisper-1",
      base_url: null,
      is_default: false,
      capability: "asr",
      validation: {
        last_validated_at: null,
        last_validated_latency_ms: null,
        last_validated_status: "unspecified",
        last_validated_note: null,
        last_validated_sample: null,
        last_validated_sample_result: null,
      },
      created_at: 1n,
      updated_at: 1n,
      ...overrides,
    };
  }

  it("allows switching multi-model capabilities", () => {
    expect(isModelSwitchable(CATALOG, config({ provider_id: "openai-compat" }))).toBe(true);
  });

  it("suppresses the switch control for single-model capabilities", () => {
    expect(
      isModelSwitchable(
        CATALOG,
        config({ provider_id: "mimo-api", capability: "omni", model: "mimo-v2.5" }),
      ),
    ).toBe(false);
    expect(
      isModelSwitchable(
        CATALOG,
        config({ provider_id: "doubao-asr", capability: "asr", model: "bigmodel" }),
      ),
    ).toBe(false);
  });
});

describe("saveRequestFromDraft", () => {
  function omniDraft(overrides: Partial<ModelConfigDraft> = {}): ModelConfigDraft {
    return {
      config_id: null,
      provider_id: "mimo-api",
      capability: "omni",
      display_name: "",
      model: "mimo-v2.5",
      base_url: "",
      api_key: "sk-test",
      app_key: "",
      access_key: "",
      is_default: true,
      ...overrides,
    };
  }

  it("carries the capability and trims optional fields to null", () => {
    const req = saveRequestFromDraft(omniDraft());
    expect(req.capability).toBe("omni");
    expect(req.provider_id).toBe("mimo-api");
    expect(req.model).toBe("mimo-v2.5");
    expect(req.display_name).toBeNull();
    expect(req.base_url).toBeNull();
    expect(req.api_key).toBe("sk-test");
    expect(req.config_id).toBeNull();
  });

  it("keeps is_default true only for omni capability", () => {
    expect(saveRequestFromDraft(omniDraft()).is_default).toBe(true);
    const asr = saveRequestFromDraft(
      omniDraft({ capability: "asr", provider_id: "openai-compat", model: "whisper-1", is_default: true }),
    );
    expect(asr.is_default).toBe(false);
  });

  it("joins the doubao key pair into api_key", () => {
    const req = saveRequestFromDraft(
      omniDraft({
        provider_id: "doubao-asr",
        capability: "asr",
        model: "bigmodel",
        api_key: "",
        app_key: "app",
        access_key: "secret",
        is_default: false,
      }),
    );
    expect(req.api_key).toBe("app:secret");
  });

  it("sends a blank doubao pair as null (keep existing secret on edit)", () => {
    const req = saveRequestFromDraft(
      omniDraft({
        provider_id: "doubao-asr",
        capability: "asr",
        model: "bigmodel",
        api_key: "",
        app_key: "",
        access_key: "",
        is_default: false,
      }),
    );
    expect(req.api_key).toBeNull();
  });

  it("sends a blank api_key as null", () => {
    expect(saveRequestFromDraft(omniDraft({ api_key: "   " })).api_key).toBeNull();
  });
});

describe("draftFromConfig", () => {
  function makeConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
    return {
      config_id: "cfg-1",
      provider_id: "openai-compat",
      display_name: "My ASR",
      model: "whisper-1",
      base_url: "https://api.example.com/v1",
      is_default: false,
      capability: "asr",
      validation: {
        last_validated_at: null,
        last_validated_latency_ms: null,
        last_validated_status: "unspecified",
        last_validated_note: null,
        last_validated_sample: null,
        last_validated_sample_result: null,
      },
      created_at: 1n,
      updated_at: 1n,
      ...overrides,
    } as ProviderConfig;
  }

  it("seeds an editable draft with a blank api_key and the config's fixed vendor + capability", () => {
    const draft = draftFromConfig(makeConfig());
    expect(draft.config_id).toBe("cfg-1");
    expect(draft.provider_id).toBe("openai-compat");
    expect(draft.capability).toBe("asr");
    expect(draft.model).toBe("whisper-1");
    expect(draft.base_url).toBe("https://api.example.com/v1");
    expect(draft.display_name).toBe("My ASR");
    expect(draft.api_key).toBe("");
    expect(draft.app_key).toBe("");
    expect(draft.access_key).toBe("");
    expect(draft.is_default).toBe(false);
  });

  it("maps a null base_url/display_name to empty strings", () => {
    const draft = draftFromConfig(makeConfig({ base_url: null, display_name: null }));
    expect(draft.base_url).toBe("");
    expect(draft.display_name).toBe("");
  });
});

describe("prettifyModelId", () => {
  it.each([
    ["doubao-seed-2-0-lite-260428", "Doubao Seed 2.0 Lite"],
    ["doubao-seed-2-0-mini-260428", "Doubao Seed 2.0 Mini"],
    ["qwen3.5-omni-flash", "Qwen3.5 Omni Flash"],
    ["qwen3-asr-flash-realtime", "Qwen3 ASR Flash Realtime"],
    ["gpt-4o-mini", "GPT 4o Mini"],
    ["gpt-4.1-mini", "GPT 4.1 Mini"],
    ["whisper-large-v3", "Whisper Large V3"],
    ["whisper-1", "Whisper 1"],
    ["mimo-v2.5", "MiMo V2.5"],
    ["bigmodel", "Bigmodel"],
    ["", ""],
  ])("prettifies %s -> %s", (input, expected) => {
    expect(prettifyModelId(input)).toBe(expected);
  });
});

describe("consoleUrlForProvider", () => {
  it("points Doubao Ark at the Volcengine Ark API-key console", () => {
    expect(consoleUrlForProvider("doubao-ark")).toBe(
      "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
    );
  });

  it("points both Qwen families at the Bailian API-key console", () => {
    const bailian = "https://bailian.console.aliyun.com/cn-beijing?tab=model#/api-key";
    expect(consoleUrlForProvider("dashscope")).toBe(bailian);
    expect(consoleUrlForProvider("dashscope-realtime")).toBe(bailian);
  });

  it("returns null for vendors without a mapped console (incl. doubao-asr)", () => {
    expect(consoleUrlForProvider("doubao-asr")).toBeNull();
    expect(consoleUrlForProvider("mimo-api")).toBeNull();
    expect(consoleUrlForProvider("openai-compat")).toBeNull();
    expect(consoleUrlForProvider("unknown-x")).toBeNull();
  });
});
