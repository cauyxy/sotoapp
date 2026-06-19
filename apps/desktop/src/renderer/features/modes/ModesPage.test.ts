// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Mode } from "@soto/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ModesPage } from "./ModesPage";

vi.mock("../../i18n/context", () => ({
  useT: () => (key: string, values?: Record<string, string>) =>
    key === "modes.deleteModeConfirm" && values?.name
      ? `${key}:${values.name}`
      : key,
}));

vi.mock("../../store/appStore", () => ({
  useAppStore: (selector: (state: { view: string }) => unknown) =>
    selector({ view: "Modes" }),
}));

const ipc = vi.hoisted(() => ({
  createMode: vi.fn(),
  deleteMode: vi.fn(),
  saveMode: vi.fn(async (mode: Mode) => mode),
  confirmDialog: vi.fn(async () => true),
  rendererOs: vi.fn(() => "mac" as const),
  beginHotkeyCapture: vi.fn(async () => ({
    active: true,
    sessionId: 1,
    suppressing: false,
  })),
  endHotkeyCapture: vi.fn(async () => undefined),
  onHotkeyCaptureKey: vi.fn(() => () => undefined),
}));

vi.mock("../../ipc", () => ipc);

const model = vi.hoisted(() => ({
  modes: [] as Mode[],
  refresh: vi.fn(),
}));

vi.mock("../../store/appResources", () => ({
  useAppModel: () => ({ modes: model.modes }),
  useAppResources: () => ({ refresh: model.refresh }),
}));

function mode(overrides: Partial<Mode> & Pick<Mode, "id">): Mode {
  const { id, ...rest } = overrides;
  const now = 1n;
  return {
    id,
    name: id,
    prompt_body: "",
    hotkey: null,
    display_order: 0,
    built_in: true,
    created_at: now,
    updated_at: now,
    ...rest,
  };
}

let root: Root | null = null;

function renderModesPage(): void {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(React.createElement(ModesPage));
  });
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function nativeSetValue(el: HTMLInputElement, value: string): void {
  const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
  desc?.set?.call(el, value);
}

beforeEach(() => {
  (globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }).IS_REACT_ACT_ENVIRONMENT = true;
  model.modes = [
    mode({ id: "default", name: "Default", prompt_body: "alpha" }),
    mode({ id: "translate", name: "Translate", prompt_body: "beta" }),
  ];
  ipc.createMode.mockImplementation(async (name: string) =>
    mode({
      id: "mode.custom.created",
      name,
      prompt_body: "",
      display_order: 2,
      built_in: false,
    }),
  );
  ipc.deleteMode.mockResolvedValue(undefined);
  ipc.saveMode.mockImplementation(async (next: Mode) => next);
  ipc.confirmDialog.mockResolvedValue(true);
});

afterEach(() => {
  if (root !== null) {
    act(() => root?.unmount());
    root = null;
  }
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("ModesPage", () => {
  it("renders the initial mode list with every card collapsed", () => {
    renderModesPage();

    const toggles = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".mode-card-main-button"),
    );
    expect(toggles).toHaveLength(2);
    expect(toggles.map((button) => button.getAttribute("aria-expanded"))).toEqual([
      "false",
      "false",
    ]);
    expect(document.querySelector(".prompt-editor")).toBeNull();
  });

  it("renders the dashed empty slot when a mode has no shortcut", () => {
    renderModesPage();
    expect(document.querySelector(".mode-card-hotkey-empty")).not.toBeNull();
    expect(
      document.querySelector(".mode-card-hotkey-button .key-combo"),
    ).toBeNull();
  });

  it("uses the bound-shortcut aria key when a chord is set", () => {
    model.modes = [
      mode({ id: "default", name: "Default", hotkey: { chord: "RightCtrl" } }),
    ];
    renderModesPage();
    const button = document.querySelector<HTMLButtonElement>(
      ".mode-card-hotkey-button",
    );
    expect(button?.getAttribute("aria-label")).toBe(
      "modes.shortcutButtonBoundAria",
    );
    expect(document.querySelector(".mode-card-hotkey-button .key-combo")).not.toBeNull();
  });

  it("renders the create-mode card", () => {
    renderModesPage();

    const addItem = document.querySelector<HTMLElement>(".mode-card-add-item");
    expect(addItem?.getAttribute("role")).toBe("listitem");
    const add = document.querySelector<HTMLButtonElement>(".mode-card-add");
    expect(add).not.toBeNull();
    expect(add?.getAttribute("type")).toBe("button");
    expect(add?.textContent).toContain("modes.newModeButton");
  });

  it("keeps every direct list child as a listitem", () => {
    renderModesPage();

    const list = document.querySelector<HTMLElement>('[role="list"]');
    expect(list).not.toBeNull();
    expect(
      Array.from(list!.children).map((child) => child.getAttribute("role")),
    ).toEqual(["listitem", "listitem", "listitem"]);
  });

  it("keeps the hotkey modal outside the mode list", async () => {
    renderModesPage();

    const button = document.querySelector<HTMLButtonElement>(
      ".mode-card-hotkey-button",
    );
    expect(button).not.toBeNull();
    await click(button!);

    const list = document.querySelector<HTMLElement>('[role="list"]');
    expect(list).not.toBeNull();
    const directChildren = Array.from(list!.children);
    expect(directChildren.map((child) => child.getAttribute("role"))).toEqual([
      "listitem",
      "listitem",
      "listitem",
    ]);

    const scrim = document.querySelector<HTMLElement>(".binding-scrim");
    expect(scrim).not.toBeNull();
    expect(directChildren).not.toContain(scrim);
  });

  it("keeps built-in expanded cards read-only for mode identity", async () => {
    renderModesPage();

    const toggle = document.querySelector<HTMLButtonElement>(".mode-card-main-button");
    expect(toggle).not.toBeNull();
    await click(toggle!);

    expect(document.querySelector(".prompt-editor")).not.toBeNull();
    expect(document.querySelector(".mode-card-name-field input")).toBeNull();
    expect(document.querySelector(".mode-card-delete")).toBeNull();
  });

  it("renders editable name and delete controls for a custom expanded card", async () => {
    model.modes = [
      mode({ id: "default", name: "Default", prompt_body: "alpha" }),
      mode({
        id: "mode.custom",
        name: "Custom",
        prompt_body: "custom prompt",
        display_order: 1,
        built_in: false,
      }),
    ];
    renderModesPage();

    const customToggle = document.querySelectorAll<HTMLButtonElement>(
      ".mode-card-main-button",
    )[1];
    expect(customToggle).not.toBeUndefined();
    await click(customToggle!);

    const input = document.querySelector<HTMLInputElement>(
      ".mode-card-name-field input",
    );
    expect(input).not.toBeNull();
    expect(input?.value).toBe("Custom");
    expect(input?.getAttribute("aria-label")).toBe("modes.nameLabel");
    expect(document.querySelector(".mode-card-delete")).not.toBeNull();
  });

  it("creates and expands a custom mode from the add card", async () => {
    renderModesPage();

    const add = document.querySelector<HTMLButtonElement>(".mode-card-add");
    expect(add).not.toBeNull();
    await click(add!);

    expect(ipc.createMode).toHaveBeenCalledWith("modes.newModeDefaultName");
    await vi.waitFor(() => {
      const input = document.querySelector<HTMLInputElement>(
        ".mode-card-name-field input",
      );
      expect(input).not.toBeNull();
      expect(input?.value).toBe("modes.newModeDefaultName");
      expect(document.activeElement).toBe(input);
    });
  });

  it("confirms before deleting a custom mode", async () => {
    model.modes = [
      mode({ id: "default", name: "Default", prompt_body: "alpha" }),
      mode({
        id: "mode.custom",
        name: "Custom",
        prompt_body: "custom prompt",
        display_order: 1,
        built_in: false,
      }),
    ];
    renderModesPage();

    const customToggle = document.querySelectorAll<HTMLButtonElement>(
      ".mode-card-main-button",
    )[1];
    expect(customToggle).not.toBeUndefined();
    await click(customToggle!);

    const del = document.querySelector<HTMLButtonElement>(".mode-card-delete");
    expect(del).not.toBeNull();
    await click(del!);

    expect(ipc.confirmDialog).toHaveBeenCalledWith({
      message: "modes.deleteModeConfirm:Custom",
      detail: "modes.deleteModeConfirmBody",
      confirmLabel: "modes.deleteModeConfirmOk",
      cancelLabel: "modes.deleteModeConfirmCancel",
    });
    expect(ipc.deleteMode).toHaveBeenCalledWith("mode.custom");
  });

  it("uses the unsaved draft name in the delete confirmation", async () => {
    model.modes = [
      mode({ id: "default", name: "Default", prompt_body: "alpha" }),
      mode({
        id: "mode.custom",
        name: "Custom",
        prompt_body: "custom prompt",
        display_order: 1,
        built_in: false,
      }),
    ];
    renderModesPage();

    const customToggle = document.querySelectorAll<HTMLButtonElement>(
      ".mode-card-main-button",
    )[1];
    expect(customToggle).not.toBeUndefined();
    await click(customToggle!);

    const input = document.querySelector<HTMLInputElement>(
      ".mode-card-name-field input",
    );
    expect(input).not.toBeNull();
    await act(async () => {
      nativeSetValue(input!, "Draft Custom");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });

    const del = document.querySelector<HTMLButtonElement>(".mode-card-delete");
    expect(del).not.toBeNull();
    await click(del!);

    expect(ipc.confirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "modes.deleteModeConfirm:Draft Custom",
      }),
    );
  });

  it("does not delete a custom mode when confirmation is cancelled", async () => {
    ipc.confirmDialog.mockResolvedValue(false);
    model.modes = [
      mode({ id: "default", name: "Default", prompt_body: "alpha" }),
      mode({
        id: "mode.custom",
        name: "Custom",
        prompt_body: "custom prompt",
        display_order: 1,
        built_in: false,
      }),
    ];
    renderModesPage();

    const customToggle = document.querySelectorAll<HTMLButtonElement>(
      ".mode-card-main-button",
    )[1];
    expect(customToggle).not.toBeUndefined();
    await click(customToggle!);

    const del = document.querySelector<HTMLButtonElement>(".mode-card-delete");
    expect(del).not.toBeNull();
    await click(del!);

    expect(ipc.confirmDialog).toHaveBeenCalledTimes(1);
    expect(ipc.deleteMode).not.toHaveBeenCalled();
  });
});
