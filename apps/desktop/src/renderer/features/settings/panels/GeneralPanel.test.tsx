// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AppSettings } from "@soto/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GeneralPanel } from "./GeneralPanel";

const mocks = vi.hoisted(() => ({
  mutateAppSettings: vi.fn(),
  resources: { tag: "resources" },
  model: {
    settings: {
      locale: "zh",
      active_provider_config_id: null,
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
      history_retention_days: 0,
      current_mode_id: null,
      audio_retention_enabled: false,
      hide_app_icon: false,
      base_text_scale: "default",
      launch_at_login: true,
    } as AppSettings,
  },
}));

vi.mock("../../../store/appResources", () => ({
  useAppModel: () => mocks.model,
  useAppResources: () => mocks.resources,
  mutateAppSettings: mocks.mutateAppSettings,
}));

vi.mock("../../../store/appStore", () => ({
  applyTextScaleAttribute: vi.fn(),
}));

vi.mock("../../../i18n/context", () => ({
  useT: () => (key: string) => key,
}));

let root: Root | null = null;

function renderGeneralPanel(): void {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(React.createElement(GeneralPanel));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.mutateAppSettings.mockResolvedValue(undefined);
  mocks.model.settings.launch_at_login = true;
});

afterEach(() => {
  if (root !== null) {
    act(() => root?.unmount());
    root = null;
  }
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("GeneralPanel", () => {
  it("renders launch-at-login as an enabled general switch", () => {
    renderGeneralPanel();

    const button = document.querySelector<HTMLButtonElement>(
      `button[aria-label="settings.general.launchAtLogin"]`,
    );

    expect(button).not.toBeNull();
    expect(button?.getAttribute("aria-checked")).toBe("true");
  });

  it("saves launch-at-login when toggled", async () => {
    renderGeneralPanel();
    const button = document.querySelector<HTMLButtonElement>(
      `button[aria-label="settings.general.launchAtLogin"]`,
    );

    await act(async () => {
      button?.click();
    });

    expect(mocks.mutateAppSettings).toHaveBeenCalledWith(mocks.resources, {
      launch_at_login: false,
    });
  });
});
