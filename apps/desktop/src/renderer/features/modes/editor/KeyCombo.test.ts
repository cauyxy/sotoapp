// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { KeyCombo } from "./KeyCombo";

let root: Root | null = null;

function renderCombo(chord: string, size?: "lg"): void {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(React.createElement(KeyCombo, { chord, size }));
  });
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
  document.documentElement.removeAttribute("data-platform");
  document.body.innerHTML = "";
});

describe("KeyCombo", () => {
  it("wraps the chord in a framed slot with an inline L/R lead and macOS glyph", () => {
    renderCombo("RightCtrl");
    expect(document.querySelector(".key-combo")).not.toBeNull();
    expect(document.querySelector(".key-combo")?.getAttribute("aria-hidden")).toBe("true");
    expect(document.querySelector(".key-cap-lead")?.textContent).toBe("R");
    expect(document.querySelector(".key-cap")?.textContent).toBe("R⌃");
  });

  it("uses Windows word labels when data-platform is win32", () => {
    document.documentElement.setAttribute("data-platform", "win32");
    renderCombo("LeftMeta");
    expect(document.querySelector(".key-cap")?.textContent).toBe("LWin");
  });

  it("renders a plus separator between caps for a combo", () => {
    renderCombo("LeftCtrl+LeftShift");
    expect(document.querySelectorAll(".key-cap").length).toBe(2);
    expect(document.querySelector(".key-combo-plus")?.textContent).toBe("+");
  });

  it("renders no caps for an empty chord", () => {
    renderCombo("");
    expect(document.querySelectorAll(".key-cap").length).toBe(0);
    expect(document.querySelector(".key-combo")).not.toBeNull();
  });

  it("adds the lg slot modifier when size=lg", () => {
    renderCombo("RightCtrl", "lg");
    expect(document.querySelector(".key-combo.key-combo-lg")).not.toBeNull();
    expect(document.querySelector(".key-cap.key-cap-lg")).not.toBeNull();
  });
});
