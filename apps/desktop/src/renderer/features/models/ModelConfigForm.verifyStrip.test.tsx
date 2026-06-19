// @vitest-environment jsdom

import React, { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ProviderConfig, SupportedProvider } from "@soto/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ModelConfigForm } from "./ModelConfigForm";
import type { ModelConfigDraft } from "./modelsDraft";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  saveProviderConfig: vi.fn(),
  testProviderConfig: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("../../ipc", () => ({
  saveProviderConfig: mocks.saveProviderConfig,
  testProviderConfig: mocks.testProviderConfig,
}));

vi.mock("../../store/appResources", () => ({
  useAppModel: () => null,
  useAppResources: () => ({ refresh: mocks.refresh }),
  mutateAppSettings: vi.fn(),
}));

vi.mock("../../i18n/context", () => ({
  useT: () => (key: string, vars?: Record<string, unknown>) =>
    vars === undefined ? key : `${key} ${JSON.stringify(vars)}`,
}));

vi.mock("../../shared/ui/feedback/toast", () => ({
  toast: mocks.toast,
}));

const vendor: SupportedProvider = {
  provider_id: "dashscope",
  group: null,
  display_name: "Dashscope",
  default_base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  capabilities: {
    omni: { default_model: "qwen-omni", models: ["qwen-omni"] },
  },
  default_model: "qwen-omni",
  models: ["qwen-omni"],
};

function draft(): ModelConfigDraft {
  return {
    config_id: null,
    provider_id: "dashscope",
    capability: "omni",
    display_name: "",
    model: "qwen-omni",
    base_url: "",
    api_key: "secret",
    app_key: "",
    access_key: "",
    is_default: true,
  };
}

function providerConfig(): ProviderConfig {
  return {
    config_id: "cfg-1",
    provider_id: "dashscope",
    display_name: null,
    model: "qwen-omni",
    base_url: null,
    is_default: true,
    capability: "omni",
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

function changeInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  (globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.refresh.mockResolvedValue(undefined);
  mocks.saveProviderConfig.mockResolvedValue(providerConfig());
  mocks.testProviderConfig.mockResolvedValue({
    status: "err",
    latency_ms: 17,
    note: "bad endpoint",
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

describe("ModelConfigForm verify result strip", () => {
  it("persists a verify failure note until the draft changes", async () => {
    const host = mount(
      <ModelConfigForm
        vendor={vendor}
        catalog={[vendor]}
        capabilityOptions={["omni"]}
        initialDraft={draft()}
        editing={false}
        onCancel={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    const save = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "models.saveAndVerify",
    );
    expect(save).toBeDefined();

    await act(async () => {
      save?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });

    const strip = host.querySelector(".model-form-verify-result");
    expect(strip).not.toBeNull();
    expect(strip?.textContent).toContain("bad endpoint");

    const modelInput = host.querySelector<HTMLInputElement>(
      'input[aria-label="models.custom"]',
    );
    expect(modelInput).not.toBeNull();

    await act(async () => {
      changeInput(modelInput!, "qwen-omni-next");
      await flush();
    });

    expect(host.querySelector(".model-form-verify-result")).toBeNull();
  });
});
