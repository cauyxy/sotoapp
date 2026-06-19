import { describe, expect, it } from "vitest";
import type {
  AppSettings,
  DictionaryEntry,
  HistoryRecord,
  Mode,
  ProviderConfig,
  ProviderDefaults,
} from "@soto/core";
import type { PermissionStatus } from "@soto/native-bridge";

import {
  assembleAppModel,
  supportedProviderFromDefaults,
  type AppModelDeps,
  type AppModelStore,
} from "./appModel.js";

// --- fakes (no SqliteStore / no native binding) ---------------------------

function settings(over: Partial<AppSettings> = {}): AppSettings {
  return {
    locale: "system",
    active_provider_config_id: "cfg-1",
    engine_mode: "omni",
    active_asr_config_id: null,
    active_llm_config_id: null,
    transcription_language_hint: "",
    microphone_device_id: null,
    input_level: 0,
    history_enabled: true,
    include_window_context_in_requests: true,
    theme: "system",
    use_proxy: false,
    history_retention_days: 30,
    current_mode_id: "default",
    audio_retention_enabled: false,
    hide_app_icon: false,
    launch_at_login: true,
    base_text_scale: "default",
    ...over,
  };
}

function mode(over: Partial<Mode> = {}): Mode {
  return {
    id: "default",
    name: "Default",
    prompt_body: "",
    hotkey: { chord: "LeftMeta" },
    display_order: 0,
    built_in: true,
    created_at: 0n,
    updated_at: 0n,
    ...over,
  };
}

function providerConfig(over: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    config_id: "cfg-1",
    provider_id: "openai",
    display_name: null,
    model: "whisper-1",
    base_url: null,
    is_default: true,
    capability: "omni",
    validation: {
      last_validated_at: 1n,
      last_validated_latency_ms: 10,
      last_validated_status: "ok",
      last_validated_note: null,
      last_validated_sample: null,
      last_validated_sample_result: null,
    },
    created_at: 0n,
    updated_at: 0n,
    ...over,
  };
}

function historyRecord(): HistoryRecord {
  return {
    id: "h1",
    created_at: 5n,
    raw_text: "hi",
    processed_text: null,
    injected_text: null,
    edited_text: null,
    edited_text_status: "unavailable",
    edited_text_status_reason: null,
    mode_id: "default",
    status: "completed",
    injection_outcome: { kind: "paste_sent" },
    speaking_duration_ms: 100n,
    char_count: 2,
    target_app: null,
    target_app_name: null,
    target_window_title: null,
    target_control_type: null,
    ax_context_at_start: null,
    ax_context_at_end: null,
    audio_path: null,
    provider_id: null,
    model_id: null,
    llm_provider_id: null,
    llm_model_id: null,
    detected_language: null,
    mic_device_id: null,
  };
}

function dictionaryEntry(): DictionaryEntry {
  return { id: "d1", term: "Soto", source: "user_added", hit_count: 0, last_used_at: null, created_at: 0n };
}

function providerDefaults(): ProviderDefaults {
  const chat = {
    defaultModel: "seed-lite",
    allowedModels: ["seed-lite", "seed-mini"],
    requestProfile: "doubao_ark" as const,
  };
  return {
    providerId: "doubao-ark",
    group: null,
    defaultBaseUrl: "https://example.test/v1",
    capabilities: { omni: chat, llm: chat },
  };
}

function fakeStore(over: Partial<Record<keyof AppModelStore, unknown>> = {}): AppModelStore {
  return {
    getSettings: () => settings(),
    listModes: () => [mode()],
    listProviderConfigs: () => [providerConfig()],
    listRecentHistory: () => [historyRecord()],
    listDictionary: () => [dictionaryEntry()],
    ...(over as Partial<AppModelStore>),
  };
}

function permissions(over: Partial<Record<string, boolean>> = {}): PermissionStatus[] {
  const granted = { microphone: true, accessibility: true, ...over };
  return (Object.keys(granted) as Array<keyof typeof granted>).map((pane) => ({
    pane: pane as PermissionStatus["pane"],
    granted: granted[pane]!,
    status: granted[pane] ? "granted" : "denied",
    label: pane,
    detail: "",
  }));
}

function deps(over: Partial<AppModelDeps> = {}): AppModelDeps {
  return {
    store: fakeStore(),
    listProviderDefaults: () => [providerDefaults()],
    permissionStatuses: () => permissions(),
    listMicrophoneDevices: () => [{ id: "mic-1", label: "Built-in", is_default: true }],
    nativeRuntimeAvailable: true,
    ...over,
  };
}

describe("assembleAppModel", () => {
  it("assembles a ready model with all slices passed through", async () => {
    const model = await assembleAppModel(deps());

    expect(model.readiness).toEqual({ state: "ready", currentModeId: "default", providerConfigId: "cfg-1" });
    expect(model.activeModeId).toBe("default");
    expect(model.activeProviderConfigId).toBe("cfg-1");
    expect(model.modes).toHaveLength(1);
    expect(model.recentHistory).toHaveLength(1);
    expect(model.dictionary[0]!.term).toBe("Soto");
    expect(model.microphones).toEqual([{ id: "mic-1", label: "Built-in", is_default: true }]);
    expect("updateStatus" in model).toBe(false);
    expect(model.permissions).toHaveLength(2);
  });

  it("maps the provider catalog into the renderer SupportedProvider shape", async () => {
    const model = await assembleAppModel(deps());
    expect(model.providerCatalog).toEqual([
      {
        provider_id: "doubao-ark",
        group: null,
        display_name: "Doubao Ark",
        default_base_url: "https://example.test/v1",
        capabilities: {
          omni: { default_model: "seed-lite", models: ["seed-lite", "seed-mini"] },
          llm: { default_model: "seed-lite", models: ["seed-lite", "seed-mini"] },
        },
        default_model: "seed-lite",
        models: ["seed-lite", "seed-mini"],
      },
    ]);
  });

  it("reports blocked readiness (and null active ids) when no provider is configured", async () => {
    const model = await assembleAppModel(
      deps({
        store: fakeStore({
          listProviderConfigs: () => [],
          getSettings: () => settings({ active_provider_config_id: null }),
        }),
      }),
    );
    expect(model.readiness.state).toBe("blocked");
    expect(model.activeProviderConfigId).toBeNull();
    if (model.readiness.state !== "blocked") throw new Error("unreachable");
    expect(model.readiness.blockers).toContainEqual({ kind: "missing_provider" });
  });

  it("propagates native-runtime-unavailable into readiness", async () => {
    const model = await assembleAppModel(deps({ nativeRuntimeAvailable: false }));
    if (model.readiness.state !== "blocked") throw new Error("expected blocked");
    expect(model.readiness.blockers).toContainEqual({ kind: "native_runtime_unavailable" });
  });

  it("awaits an async microphone enumeration", async () => {
    const model = await assembleAppModel(
      deps({ listMicrophoneDevices: () => Promise.resolve([{ id: "usb", label: "USB", is_default: false }]) }),
    );
    expect(model.microphones).toEqual([{ id: "usb", label: "USB", is_default: false }]);
  });
});

describe("supportedProviderFromDefaults", () => {
  it("humanizes the provider id into a display name", () => {
    expect(supportedProviderFromDefaults(providerDefaults())).toEqual({
      provider_id: "doubao-ark",
      group: null,
      display_name: "Doubao Ark",
      default_base_url: "https://example.test/v1",
      capabilities: {
        omni: { default_model: "seed-lite", models: ["seed-lite", "seed-mini"] },
        llm: { default_model: "seed-lite", models: ["seed-lite", "seed-mini"] },
      },
      default_model: "seed-lite",
      models: ["seed-lite", "seed-mini"],
    });
  });

  it("passes provider groups through to the renderer DTO", () => {
    expect(supportedProviderFromDefaults({ ...providerDefaults(), group: "mimo" }).group).toBe(
      "mimo",
    );
  });
});
