// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PromptEditor } from "./PromptEditor";

vi.mock("../../../i18n/context", () => ({
  useT: () => (key: string) => key,
}));

let root: Root | null = null;
let scrollHeightDescriptor: PropertyDescriptor | undefined;
let scrollHeight = 320;

function renderPrompt(value: string): void {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(React.createElement(PromptEditor, { value, onChange: vi.fn() }));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }).IS_REACT_ACT_ENVIRONMENT = true;
  scrollHeight = 320;
  scrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "scrollHeight");
  Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return scrollHeight;
    },
  });
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
});

afterEach(() => {
  if (root !== null) {
    act(() => root?.unmount());
    root = null;
  }
  if (scrollHeightDescriptor === undefined) {
    delete (HTMLTextAreaElement.prototype as unknown as Record<string, unknown>).scrollHeight;
  } else {
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", scrollHeightDescriptor);
  }
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("PromptEditor autosize", () => {
  it("sizes the textarea to scrollHeight and remeasures after layout resize", () => {
    renderPrompt("long prompt");

    const textarea = document.querySelector<HTMLTextAreaElement>(".prompt-editor-body");
    expect(textarea).not.toBeNull();
    expect(textarea?.style.height).toBe("320px");

    scrollHeight = 460;
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(textarea?.style.height).toBe("460px");
  });
});
