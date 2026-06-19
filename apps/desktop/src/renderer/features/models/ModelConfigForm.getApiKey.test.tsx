// @vitest-environment jsdom

import React, { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AppSettings, SupportedProvider } from "@soto/core";
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
    engine_mode: "omni",
    active_asr_config_id: null,
    active_llm_config_id: null,
    ...overrides,
  } as AppSettings;
}

function omniVendor(providerId: string): SupportedProvider {
  return {
    provider_id: providerId,
    group: null,
    display_name: providerId,
    default_base_url: "https://example.com/v1",
    capabilities: {
      omni: { default_model: "m-1", models: ["m-1"] },
      llm: { default_model: "m-1", models: ["m-1"] },
    },
    default_model: "m-1",
    models: ["m-1"],
  };
}

function draftFor(providerId: string): ModelConfigDraft {
  return {
    config_id: null,
    provider_id: providerId,
    capability: "omni",
    display_name: "",
    model: "m-1",
    base_url: "",
    api_key: "",
    app_key: "",
    access_key: "",
    is_default: true,
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

function renderForm(providerId: string): HTMLElement {
  const vendor = omniVendor(providerId);
  return mount(
    <ModelConfigForm
      vendor={vendor}
      catalog={[vendor]}
      capabilityOptions={["omni", "llm"]}
      initialDraft={draftFor(providerId)}
      editing={false}
      onCancel={vi.fn()}
      onSaved={vi.fn()}
    />,
  );
}

function getApiKeyLink(host: HTMLElement): HTMLAnchorElement | null {
  return host.querySelector<HTMLAnchorElement>("a.model-form-getkey");
}

beforeEach(() => {
  (globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.appModel = { settings: settings() };
});

afterEach(() => {
  if (root !== null) {
    act(() => root?.unmount());
    root = null;
  }
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("ModelConfigForm get-API-key CTA", () => {
  it("links Doubao Ark to the Volcengine Ark console, opening externally", () => {
    const link = getApiKeyLink(renderForm("doubao-ark"));
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe(
      "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
    );
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toContain("noopener");
  });

  it("links Qwen (dashscope) to the Bailian console", () => {
    const link = getApiKeyLink(renderForm("dashscope"));
    expect(link?.getAttribute("href")).toBe(
      "https://bailian.console.aliyun.com/cn-beijing?tab=model#/api-key",
    );
  });

  it("shows no CTA for a vendor without a mapped console", () => {
    expect(getApiKeyLink(renderForm("openai-compat"))).toBeNull();
  });
});
