// @vitest-environment jsdom

import React, { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AppSettings, ProviderConfig, SupportedProvider } from "@soto/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ModelConfigForm } from "./ModelConfigForm";
import type { ModelConfigDraft } from "./modelsDraft";

const mocks = vi.hoisted(() => ({
  appModel: null as unknown,
  resources: { refresh: vi.fn() },
  mutateAppSettings: vi.fn(),
  saveProviderConfig: vi.fn(),
  testProviderConfig: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("../../ipc", () => ({
  saveProviderConfig: mocks.saveProviderConfig,
  testProviderConfig: mocks.testProviderConfig,
}));

vi.mock("../../store/appResources", () => ({
  useAppModel: () => mocks.appModel,
  useAppResources: () => mocks.resources,
  mutateAppSettings: mocks.mutateAppSettings,
}));

vi.mock("../../i18n/context", () => ({
  useT: () => (key: string) => key,
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
    engine_mode: "asr_llm",
    active_asr_config_id: null,
    active_llm_config_id: null,
    ...overrides,
  } as AppSettings;
}

const vendor: SupportedProvider = {
  provider_id: "openai-compat",
  group: null,
  display_name: "OpenAI compatible",
  default_base_url: "https://api.openai.com/v1",
  capabilities: {
    asr: { default_model: "whisper-1", models: ["whisper-1"] },
  },
  default_model: "whisper-1",
  models: ["whisper-1"],
};

function draft(): ModelConfigDraft {
  return {
    config_id: null,
    provider_id: "openai-compat",
    capability: "asr",
    display_name: "",
    model: "whisper-1",
    base_url: "",
    api_key: "secret",
    app_key: "",
    access_key: "",
    is_default: false,
  };
}

function providerConfig(): ProviderConfig {
  return {
    config_id: "cfg-asr",
    provider_id: "openai-compat",
    display_name: null,
    model: "whisper-1",
    base_url: null,
    is_default: false,
    capability: "asr",
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

let root: Root | null = null;

function mount(el: ReactElement): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(el);
  });
  return host;
}

async function flush(): Promise<void> {
  await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

function renderForm(): HTMLElement {
  return mount(
    <ModelConfigForm
      vendor={vendor}
      catalog={[vendor]}
      capabilityOptions={["asr"]}
      initialDraft={draft()}
      editing={false}
      onCancel={vi.fn()}
      onSaved={vi.fn()}
    />,
  );
}

beforeEach(() => {
  (globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.appModel = { settings: settings() };
  mocks.resources.refresh.mockResolvedValue(undefined);
  mocks.mutateAppSettings.mockResolvedValue(undefined);
  mocks.saveProviderConfig.mockResolvedValue(providerConfig());
  mocks.testProviderConfig.mockResolvedValue({
    status: "ok",
    latency_ms: 5,
    note: "",
  });
});

afterEach(() => {
  if (root !== null) {
    act(() => root?.unmount());
    root = null;
  }
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("ModelConfigForm save and set active", () => {
  it("sets the saved config as active when the engine mode uses its capability", async () => {
    const host = renderForm();
    const saveAndSetActive = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "models.saveAndSetActive",
    );
    expect(saveAndSetActive).toBeDefined();

    await act(async () => {
      saveAndSetActive?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });

    expect(mocks.mutateAppSettings).toHaveBeenCalledWith(
      mocks.resources,
      { active_asr_config_id: "cfg-asr" },
    );
  });

  it("hides save-and-set-active when the engine mode does not use the draft capability", () => {
    mocks.appModel = { settings: settings({ engine_mode: "omni" }) };
    const host = renderForm();

    expect(host.textContent).toContain("models.saveAndVerify");
    expect(host.textContent).not.toContain("models.saveAndSetActive");
  });
});
