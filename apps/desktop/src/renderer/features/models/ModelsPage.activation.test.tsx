// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AppSettings, Capability, ProviderConfig, SupportedProvider } from "@soto/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ModelsPage } from "./ModelsPage";

const mocks = vi.hoisted(() => ({
  model: null as unknown,
  resources: { refresh: vi.fn(), tag: "resources" },
  mutateAppSettings: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("../../store/appResources", () => ({
  useAppModel: () => mocks.model,
  useAppResources: () => mocks.resources,
  mutateAppSettings: mocks.mutateAppSettings,
}));

vi.mock("../../i18n/context", () => ({
  useT: () => (key: string, vars?: Record<string, unknown>) =>
    vars === undefined ? key : `${key} ${Object.values(vars).join(" ")}`,
}));

vi.mock("../../ipc", () => ({
  confirmDialog: vi.fn(),
  deleteProviderConfig: vi.fn(),
  saveProviderConfig: vi.fn(),
  testProviderConfig: vi.fn(),
}));

vi.mock("../../shared/ui/feedback/toast", () => ({
  toast: mocks.toast,
}));

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    locale: "zh",
    active_provider_config_id: null,
    transcription_language_hint: "",
    theme: "system",
    hide_app_icon: false,
    launch_at_login: false,
    show_recording_badge: true,
    double_tap_ms: 350,
    base_text_scale: 1,
    microphone_device_id: null,
    use_proxy: false,
    include_window_context_in_requests: false,
    current_mode_id: null,
    engine_mode: "omni",
    active_asr_config_id: null,
    active_llm_config_id: null,
    ...overrides,
  } as AppSettings;
}

function provider(id: string, capability: Capability): SupportedProvider {
  return {
    provider_id: id,
    group: null,
    display_name: `${capability} Provider`,
    default_base_url: null,
    capabilities: {
      [capability]: { default_model: `${capability}-model`, models: [`${capability}-model`] },
    },
    default_model: `${capability}-model`,
    models: [`${capability}-model`],
  } as SupportedProvider;
}

function cfg(id: string, capability: Capability, displayName: string): ProviderConfig {
  return {
    config_id: id,
    provider_id: `${capability}-provider`,
    display_name: displayName,
    model: `${capability}-model`,
    base_url: null,
    is_default: false,
    capability,
    validation: {
      last_validated_at: null,
      last_validated_latency_ms: null,
      last_validated_status: "ok",
      last_validated_note: null,
      last_validated_sample: null,
      last_validated_sample_result: null,
    },
    created_at: 1n,
    updated_at: 1n,
  };
}

function setModel(next: {
  settings: AppSettings;
  providerConfigs: ProviderConfig[];
  providerCatalog?: SupportedProvider[];
}): void {
  mocks.model = {
    settings: next.settings,
    providerConfigs: next.providerConfigs,
    providerCatalog:
      next.providerCatalog ??
      (["omni", "asr", "llm"] as const).map((cap) => provider(`${cap}-provider`, cap)),
    readiness: { state: "ready" },
    modes: [],
    activeModeId: null,
    recentHistory: [],
  };
}

let root: Root | null = null;

function renderModels(): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(<ModelsPage />);
  });
  return host;
}

beforeEach(() => {
  (globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.mutateAppSettings.mockResolvedValue(undefined);
});

afterEach(() => {
  if (root !== null) {
    act(() => root?.unmount());
    root = null;
  }
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("ModelsPage per-card activation", () => {
  it("marks the resolved active config with slot-specific in-use state", () => {
    setModel({
      settings: settings({ engine_mode: "asr_llm", active_asr_config_id: "asr-1" }),
      providerConfigs: [cfg("asr-1", "asr", "ASR One")],
    });

    const host = renderModels();
    const card = host.querySelector(".model-config-card");
    expect(card?.classList.contains("is-active")).toBe(true);
    expect(card?.textContent).toContain("models.inUseSlot");
    expect(card?.textContent).toContain("settings.engine.slot.asr");
  });

  it("sets an eligible inactive config as the active slot", () => {
    setModel({
      settings: settings({ engine_mode: "asr_llm" }),
      providerConfigs: [cfg("asr-1", "asr", "ASR One")],
    });

    const host = renderModels();
    const activate = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("models.setActive") ?? false,
    );
    expect(activate).toBeDefined();

    act(() => {
      activate?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mocks.mutateAppSettings).toHaveBeenCalledWith(mocks.resources, {
      active_asr_config_id: "asr-1",
    });
  });

  it("shows dormant state for configs unused by the current engine mode", () => {
    setModel({
      settings: settings({ engine_mode: "asr_llm" }),
      providerConfigs: [cfg("omni-1", "omni", "Omni One")],
    });

    const host = renderModels();
    const card = host.querySelector(".model-config-card");
    expect(card?.textContent).toContain("models.dormant");
    expect(card?.textContent).not.toContain("models.setActive");
  });

  it("shows the vendor source subtitle and prettified static model without changing the raw config model", () => {
    const openAiConfig: ProviderConfig = {
      ...cfg("asr-1", "asr", "OpenAI Whisper"),
      provider_id: "openai-compat",
      model: "whisper-1",
    };
    setModel({
      settings: settings({ engine_mode: "asr_llm", active_asr_config_id: "asr-1" }),
      providerConfigs: [openAiConfig],
      providerCatalog: [
        {
          provider_id: "openai-compat",
          group: null,
          display_name: "OpenAI-compatible",
          default_base_url: null,
          capabilities: {
            asr: { default_model: "whisper-1", models: ["whisper-1"] },
          },
          default_model: "whisper-1",
          models: ["whisper-1"],
        } as SupportedProvider,
      ],
    });

    const host = renderModels();
    const card = host.querySelector(".model-config-card");

    expect(card?.querySelector(".model-card-vendor")?.textContent).toBe(
      "models.vendorSource.custom",
    );
    expect(card?.querySelector(".model-card-model-static")?.textContent).toBe("Whisper 1");
    expect(openAiConfig.model).toBe("whisper-1");
  });
});
