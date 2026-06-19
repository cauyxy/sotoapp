// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { VoiceRuntimeEvent } from "@soto/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { _resetForTesting, getAlerts } from "../shared/ui/feedback/alerts";

const testBridge = vi.hoisted(() => ({
  voiceRuntimeCallback: null as ((payload: unknown) => void) | null,
  openPermissionSettings: vi.fn(),
  setView: vi.fn(),
}));

vi.mock("../ipc", () => ({
  hasBridge: () => true,
  onMenuAction: () => () => undefined,
  onVoiceRuntime: (cb: (payload: unknown) => void) => {
    testBridge.voiceRuntimeCallback = cb;
    return () => {
      if (testBridge.voiceRuntimeCallback === cb) testBridge.voiceRuntimeCallback = null;
    };
  },
  openPermissionSettings: testBridge.openPermissionSettings,
  windowPlatform: () => "darwin",
}));

vi.mock("../i18n/context", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("../store/appResources", () => ({
  AppResourcesProvider: ({ children }: { children: React.ReactNode }) => children,
  useAppModelState: () => ({ status: "loading" }),
}));

vi.mock("../store/appStore", () => ({
  applyThemeAttribute: vi.fn(),
  reconcileChromeFromSettings: vi.fn(),
  useAppStore: (selector: (state: { setView: (view: string) => void }) => unknown) =>
    selector({ setView: testBridge.setView }),
  useTheme: () => "system",
  useView: () => "Home",
}));

vi.mock("../shared/ui/layout/Sidebar", () => ({
  Sidebar: () => null,
}));

vi.mock("../shared/ui/feedback/ToastHost", () => ({
  ToastHost: () => null,
}));

vi.mock("../shared/ui/primitives/SotoMark", () => ({
  SotoMark: () => null,
}));

vi.mock("../features/home/HomePage", () => ({
  HomePage: () => null,
}));

vi.mock("../features/dictionary/DictionaryPage", () => ({
  DictionaryPage: () => null,
}));

vi.mock("../features/settings/SettingsPage", () => ({
  SettingsPage: () => null,
}));

let root: Root | null = null;

function renderApp(): void {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(React.createElement(App));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }).IS_REACT_ACT_ENVIRONMENT = true;
  testBridge.voiceRuntimeCallback = null;
  _resetForTesting();
});

afterEach(() => {
  if (root !== null) {
    act(() => root?.unmount());
    root = null;
  }
  testBridge.voiceRuntimeCallback = null;
  _resetForTesting();
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("App voice runtime alerts", () => {
  it("does not mirror capsule notices into main-window alerts", () => {
    renderApp();

    const event: VoiceRuntimeEvent = {
      kind: "completed",
      history_id: "h",
      raw_text: "hello",
      processed_text: null,
      final_text: "hello",
      status: "completed",
      injection_outcome: { kind: "manual_copy_required", reason: "clipboard_unrestorable" },
    };

    act(() => {
      testBridge.voiceRuntimeCallback?.(event);
    });

    expect(getAlerts()).toEqual([]);
  });
});
