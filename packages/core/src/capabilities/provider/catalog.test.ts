import { describe, expect, it } from "vitest";
import {
  capabilityDefaultsFor,
  listProviderDefaults,
  providerDefaultsFor,
  DASHSCOPE_REALTIME_DEFAULT_BASE_URL,
  DASHSCOPE_REALTIME_PROVIDER_ID,
  DASHSCOPE_PROVIDER_ID,
  DOUBAO_ARK_PROVIDER_ID,
  DOUBAO_ASR_PROVIDER_ID,
  MIMO_API_PROVIDER_ID,
  OPENAI_COMPAT_PROVIDER_ID,
} from "./catalog.js";

describe("provider catalog", () => {
  it("keys every entry by its own providerId", () => {
    for (const entry of listProviderDefaults()) {
      expect(providerDefaultsFor(entry.providerId)).toBe(entry);
      // The lookup key must equal the entry's providerId field.
      expect(providerDefaultsFor(entry.providerId)?.providerId).toBe(entry.providerId);
    }
  });

  it("lists exactly the v1 vendors", () => {
    expect(listProviderDefaults().map((e) => e.providerId).sort()).toEqual(
      [
        DASHSCOPE_PROVIDER_ID,
        DASHSCOPE_REALTIME_PROVIDER_ID,
        DOUBAO_ARK_PROVIDER_ID,
        DOUBAO_ASR_PROVIDER_ID,
        MIMO_API_PROVIDER_ID,
        OPENAI_COMPAT_PROVIDER_ID,
      ].sort(),
    );
  });

  it("gives mimo-api omni + llm and no asr", () => {
    const defaults = providerDefaultsFor(MIMO_API_PROVIDER_ID)!;
    const caps = defaults.capabilities;
    expect(defaults.group).toBeNull();
    expect(Object.keys(caps).sort()).toEqual(["llm", "omni"]);
    expect(caps.asr).toBeUndefined();
    expect(caps.omni!.requestProfile).toBe("mimo");
    expect(caps.llm!.requestProfile).toBe("mimo");
  });

  it("gives doubao-ark omni + llm (doubao_ark profile) and no asr", () => {
    const defaults = providerDefaultsFor(DOUBAO_ARK_PROVIDER_ID)!;
    const caps = defaults.capabilities;
    expect(defaults.group).toBeNull();
    expect(Object.keys(caps).sort()).toEqual(["llm", "omni"]);
    expect(caps.asr).toBeUndefined();
    expect(caps.omni!.requestProfile).toBe("doubao_ark");
    expect(caps.llm!.requestProfile).toBe("doubao_ark");
  });

  it("gives dashscope omni + llm (dashscope profile) and no asr", () => {
    const caps = providerDefaultsFor(DASHSCOPE_PROVIDER_ID)!.capabilities;
    expect(Object.keys(caps).sort()).toEqual(["llm", "omni"]);
    expect(caps.asr).toBeUndefined();
    expect(caps.omni!.requestProfile).toBe("dashscope");
    expect(caps.llm!.requestProfile).toBe("dashscope");
  });

  it("gives dashscope-realtime asr only (dashscope_realtime profile) as its own provider", () => {
    const defaults = providerDefaultsFor(DASHSCOPE_REALTIME_PROVIDER_ID)!;
    const caps = defaults.capabilities;
    expect(defaults.group).toBeNull();
    expect(defaults.defaultBaseUrl).toBe(DASHSCOPE_REALTIME_DEFAULT_BASE_URL);
    expect(Object.keys(caps)).toEqual(["asr"]);
    expect(caps.asr!.requestProfile).toBe("dashscope_realtime");
    expect(caps.asr!.defaultModel).toBe("qwen3-asr-flash-realtime");
    expect(caps.asr!.allowedModels).toEqual([
      "qwen3-asr-flash-realtime",
      "qwen3.5-omni-flash-realtime",
      "qwen3.5-omni-plus-realtime",
    ]);
  });

  it("gives openai-compat asr + llm and no omni", () => {
    const caps = providerDefaultsFor(OPENAI_COMPAT_PROVIDER_ID)!.capabilities;
    expect(Object.keys(caps).sort()).toEqual(["asr", "llm"]);
    expect(caps.omni).toBeUndefined();
    expect(caps.asr!.requestProfile).toBe("openai_transcriptions");
    expect(caps.llm!.requestProfile).toBe("openai_chat");
  });

  it("gives doubao-asr asr only (doubao_flash_asr profile)", () => {
    const caps = providerDefaultsFor(DOUBAO_ASR_PROVIDER_ID)!.capabilities;
    expect(Object.keys(caps)).toEqual(["asr"]);
    expect(caps.asr!.requestProfile).toBe("doubao_flash_asr");
  });

  it("resolves a known capability and returns null for a missing one", () => {
    expect(capabilityDefaultsFor(DOUBAO_ASR_PROVIDER_ID, "asr")).not.toBeNull();
    expect(capabilityDefaultsFor(DOUBAO_ASR_PROVIDER_ID, "llm")).toBeNull();
    expect(capabilityDefaultsFor(DOUBAO_ASR_PROVIDER_ID, "omni")).toBeNull();
    expect(capabilityDefaultsFor(DASHSCOPE_REALTIME_PROVIDER_ID, "asr")).not.toBeNull();
    expect(capabilityDefaultsFor(DASHSCOPE_REALTIME_PROVIDER_ID, "llm")).toBeNull();
    expect(capabilityDefaultsFor(MIMO_API_PROVIDER_ID, "asr")).toBeNull();
    expect(capabilityDefaultsFor("nope", "omni")).toBeNull();
  });

  it("normalises the lookup id (trim + lowercase)", () => {
    expect(providerDefaultsFor("  MIMO-API  ")?.providerId).toBe(MIMO_API_PROVIDER_ID);
    expect(capabilityDefaultsFor("  OpenAI-Compat ", "asr")?.requestProfile).toBe(
      "openai_transcriptions",
    );
  });
});
