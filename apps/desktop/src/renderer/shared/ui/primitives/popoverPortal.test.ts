// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Menu, POPOVER_VIEW_CHANGE_EVENT } from "./Menu";
import { Select } from "./Select";

const roots: Root[] = [];
let rectSpy: ReturnType<typeof vi.spyOn>;
let rectsSpy: ReturnType<typeof vi.spyOn>;
let offsetWidthDescriptor: PropertyDescriptor | undefined;
let offsetHeightDescriptor: PropertyDescriptor | undefined;
let scrollHeightDescriptor: PropertyDescriptor | undefined;

function installLayoutStubs(): void {
  rectSpy = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      const element = this;
      if (element.classList.contains("popover-panel")) {
        return DOMRect.fromRect({ x: 0, y: 0, width: 220, height: 120 });
      }
      return DOMRect.fromRect({ x: 80, y: 80, width: 240, height: 34 });
    });
  rectsSpy = vi
    .spyOn(HTMLElement.prototype, "getClientRects")
    .mockImplementation(function (this: HTMLElement) {
      return [this.getBoundingClientRect()] as unknown as DOMRectList;
    });

  offsetWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
  offsetHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  scrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      return (this as HTMLElement).classList.contains("popover-panel") ? 220 : 240;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return (this as HTMLElement).classList.contains("popover-panel") ? 120 : 34;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return (this as HTMLElement).classList.contains("popover-panel") ? 120 : 34;
    },
  });
}

function restoreDescriptor(
  name: "offsetWidth" | "offsetHeight" | "scrollHeight",
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor === undefined) {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
  } else {
    Object.defineProperty(HTMLElement.prototype, name, descriptor);
  }
}

function mount(element: React.ReactElement): HTMLElement {
  const host = document.createElement("div");
  host.className = "page";
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => {
    root.render(element);
  });
  return host;
}

function click(element: Element): void {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

beforeEach(() => {
  (globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="overlay-root"></div>';
  installLayoutStubs();
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  rectSpy.mockRestore();
  rectsSpy.mockRestore();
  restoreDescriptor("offsetWidth", offsetWidthDescriptor);
  restoreDescriptor("offsetHeight", offsetHeightDescriptor);
  restoreDescriptor("scrollHeight", scrollHeightDescriptor);
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("portaled popovers", () => {
  it("renders Select panels into overlay-root and preserves option click selection", () => {
    const onChange = vi.fn();
    const host = mount(
      React.createElement(Select, {
        value: "one",
        onChange,
        options: [
          { value: "one", label: "One" },
          { value: "two", label: "Two" },
        ],
      }),
    );

    const trigger = host.querySelector(".select-trigger");
    expect(trigger).not.toBeNull();
    act(() => click(trigger!));

    const panel = document.querySelector("#overlay-root .select-panel");
    expect(panel).not.toBeNull();
    expect(host.contains(panel)).toBe(false);

    const option = document.querySelector('[data-select-value="two"]');
    expect(option).not.toBeNull();
    act(() => {
      option!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
      click(option!);
    });

    expect(onChange).toHaveBeenCalledWith("two");
  });

  it("renders Menu panels into overlay-root and preserves item click selection", () => {
    const onSelect = vi.fn();
    const host = mount(
      React.createElement(Menu, {
        label: "More",
        items: [{ id: "archive", label: "Archive", onSelect }],
      }),
    );

    const trigger = host.querySelector(".menu-trigger");
    expect(trigger).not.toBeNull();
    act(() => click(trigger!));

    const panel = document.querySelector("#overlay-root .menu-panel");
    expect(panel).not.toBeNull();
    expect(host.contains(panel)).toBe(false);

    const item = document.querySelector("[data-popover-item]");
    expect(item).not.toBeNull();
    act(() => {
      item!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
      click(item!);
    });

    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("closes a portaled panel on active-view change without a pointerdown", () => {
    const host = mount(
      React.createElement(Select, {
        value: "one",
        onChange: vi.fn(),
        options: [
          { value: "one", label: "One" },
          { value: "two", label: "Two" },
        ],
      }),
    );

    const trigger = host.querySelector(".select-trigger");
    expect(trigger).not.toBeNull();
    act(() => click(trigger!));
    expect(document.querySelector("#overlay-root .select-panel")).not.toBeNull();

    act(() => {
      window.dispatchEvent(new Event(POPOVER_VIEW_CHANGE_EVENT));
    });

    expect(document.querySelector("#overlay-root .select-panel")).toBeNull();
  });
});
