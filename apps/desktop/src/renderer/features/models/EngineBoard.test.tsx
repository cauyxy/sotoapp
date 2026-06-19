// @vitest-environment jsdom

import React, { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AppSettings, Capability, ProviderConfig } from "@soto/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EngineBoard } from "./EngineBoard";

const mocks = vi.hoisted(() => ({
  mutateAppSettings: vi.fn(),
  resources: { tag: "resources" },
}));

vi.mock("../../store/appResources", () => ({
  useAppResources: () => mocks.resources,
  mutateAppSettings: mocks.mutateAppSettings,
}));

vi.mock("../../i18n/context", () => ({
  useT: () => (key: string) => key,
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

function cfg(
  id: string,
  capability: Capability,
  displayName: string,
  isDefault = false,
): ProviderConfig {
  return {
    config_id: id,
    provider_id: `${capability}-provider`,
    display_name: displayName,
    model: `${capability}-model`,
    base_url: null,
    is_default: isDefault,
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

describe("EngineBoard", () => {
  it("shows a resolved asr slot and lets the empty llm slot start add flow", () => {
    const add = vi.fn();
    const host = mount(
      <EngineBoard
        settings={settings({ engine_mode: "asr_llm", active_asr_config_id: "asr-1" })}
        configs={[cfg("asr-1", "asr", "ASR One")]}
        onAddForCapability={add}
        onFocusConfig={vi.fn()}
      />,
    );

    expect(host.textContent).toContain("ASR One");

    const empty = Array.from(
      host.querySelectorAll<HTMLButtonElement>("button.engine-board-slot.is-empty"),
    ).find(
      (button) => button.textContent?.includes("models.unassigned") ?? false,
    );
    expect(empty).toBeDefined();

    act(() => {
      empty?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(add).toHaveBeenCalledWith("llm");
  });

  it("shows an omni default tag without a no-op clear button", () => {
    const host = mount(
      <EngineBoard
        settings={settings({ engine_mode: "omni", active_provider_config_id: null })}
        configs={[cfg("omni-1", "omni", "Omni Default", true)]}
        onAddForCapability={vi.fn()}
        onFocusConfig={vi.fn()}
      />,
    );

    expect(host.textContent).toContain("Omni Default");
    expect(host.textContent).toContain("models.default");
    expect(host.querySelector('button[aria-label="models.clearSlot"]')).toBeNull();
  });

  it("prettifies the selected model id when the slot has no display name", () => {
    const openAiConfig: ProviderConfig = {
      ...cfg("llm-1", "llm", ""),
      provider_id: "openai-compat",
      display_name: null,
      model: "gpt-4o-mini",
    };

    const host = mount(
      <EngineBoard
        settings={settings({ engine_mode: "asr_llm", active_llm_config_id: "llm-1" })}
        configs={[openAiConfig]}
        onAddForCapability={vi.fn()}
        onFocusConfig={vi.fn()}
      />,
    );

    expect(host.textContent).toContain("openai-compat · GPT 4o Mini");
    expect(host.textContent).not.toContain("openai-compat · gpt-4o-mini");
  });

  it("clears an explicitly selected asr slot through settings mutation", () => {
    const host = mount(
      <EngineBoard
        settings={settings({ engine_mode: "asr_llm", active_asr_config_id: "asr-1" })}
        configs={[cfg("asr-1", "asr", "ASR One"), cfg("llm-1", "llm", "LLM One")]}
        onAddForCapability={vi.fn()}
        onFocusConfig={vi.fn()}
      />,
    );

    const clear = host.querySelector<HTMLButtonElement>(
      'button[aria-label="models.clearSlot"]',
    );
    expect(clear).not.toBeNull();

    act(() => {
      clear?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mocks.mutateAppSettings).toHaveBeenCalledWith(mocks.resources, {
      active_asr_config_id: null,
    });
  });

  it("renders only the mode pill when there are no configs", () => {
    const host = mount(
      <EngineBoard
        settings={settings({ engine_mode: "asr_llm" })}
        configs={[]}
        onAddForCapability={vi.fn()}
        onFocusConfig={vi.fn()}
      />,
    );

    expect(host.querySelectorAll(".engine-board-slot")).toHaveLength(0);
    expect(host.textContent).toContain("settings.engine.mode.omni");
    expect(host.textContent).toContain("settings.engine.mode.asr_llm");
  });
});
