// @vitest-environment jsdom

import React, { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { VendorAvatar } from "./modelVisuals";

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
});

afterEach(() => {
  if (root !== null) {
    act(() => root?.unmount());
    root = null;
  }
  document.body.innerHTML = "";
});

describe("VendorAvatar", () => {
  it("renders a brand logo svg for a vendor with a logo", () => {
    const host = mount(<VendorAvatar monogram="Q" providerKey="dashscope" />);
    expect(host.querySelector("svg")).not.toBeNull();
  });

  it("renders the OpenAI logo for openai-compat", () => {
    const host = mount(<VendorAvatar monogram="AI" providerKey="openai-compat" />);
    expect(host.querySelector("svg")).not.toBeNull();
  });

  it("falls back to the monogram for MiMo (no brand asset)", () => {
    const host = mount(<VendorAvatar monogram="Mi" providerKey="mimo-api" />);
    expect(host.textContent).toContain("Mi");
    expect(host.querySelector("svg")).toBeNull();
  });

  it("falls back to the monogram for an unknown provider key", () => {
    const host = mount(<VendorAvatar monogram="ZZ" providerKey="unknown-x" />);
    expect(host.textContent).toContain("ZZ");
    expect(host.querySelector("svg")).toBeNull();
  });
});
