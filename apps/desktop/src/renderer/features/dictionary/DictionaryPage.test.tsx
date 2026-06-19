// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { DictionaryEntry } from "@soto/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DictionaryPage } from "./DictionaryPage";

vi.mock("../../i18n/context", () => ({
  useT: () => (key: string) => key,
}));

const saveDictionaryEntry = vi.hoisted(() => vi.fn(async () => ({})));
const deleteDictionaryEntry = vi.hoisted(() => vi.fn(async () => ({})));
const confirmDialog = vi.hoisted(() => vi.fn(async () => true));
vi.mock("../../ipc", () => ({ saveDictionaryEntry, deleteDictionaryEntry, confirmDialog }));

vi.mock("../../shared/ui/feedback/toast", () => ({ toast: vi.fn() }));

const model = vi.hoisted(() => ({ dictionary: [] as DictionaryEntry[] }));
vi.mock("../../store/appResources", () => ({
  useAppModel: () => model,
  useAppResources: () => ({
    mutate: (fn: () => unknown) => Promise.resolve(fn()),
  }),
}));

function entry(over: Partial<DictionaryEntry> = {}): DictionaryEntry {
  return {
    id: "d1",
    term: "Soto",
    source: "user_added",
    hit_count: 0,
    last_used_at: null,
    created_at: 1n,
    ...over,
  } as DictionaryEntry;
}

// React overrides the value setter on controlled inputs; use the native
// prototype setter so a dispatched `input` event reaches React's onChange.
function nativeSetValue(el: HTMLInputElement, value: string): void {
  const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
  desc?.set?.call(el, value);
}

let root: Root | null = null;

function render(): void {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(React.createElement(DictionaryPage));
  });
}

beforeEach(() => {
  model.dictionary = [];
  saveDictionaryEntry.mockClear();
  deleteDictionaryEntry.mockClear();
  confirmDialog.mockClear();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("DictionaryPage capsule cloud", () => {
  it("renders the add control first, then one capsule per entry", () => {
    model.dictionary = [
      entry({ id: "d1", term: "Soto", source: "user_added" }),
      entry({ id: "d2", term: "周报", source: "auto_learned" }),
    ];
    render();

    const flow = document.querySelector(".vocab-flow");
    expect(flow).not.toBeNull();
    expect(flow?.getAttribute("role")).toBe("group");
    expect(flow?.firstElementChild?.classList.contains("vocab-cap-add")).toBe(true);
    expect(document.querySelectorAll(".vocab-cap").length).toBe(2);
  });

  it("colours the source dot: manual = ok, auto = neutral", () => {
    model.dictionary = [
      entry({ id: "d1", term: "Soto", source: "user_added" }),
      entry({ id: "d2", term: "周报", source: "auto_learned" }),
    ];
    render();

    const caps = Array.from(document.querySelectorAll(".vocab-cap"));
    expect(caps[0]?.querySelector(".dot.dot-ok")).not.toBeNull();
    expect(caps[1]?.querySelector(".dot.dot-neutral")).not.toBeNull();
  });

  it("drops the source-label / hit-count meta row", () => {
    model.dictionary = [entry({ id: "d1", term: "Soto", hit_count: 5 })];
    render();
    for (const selector of [".row", ".row-primary", ".row-meta", ".row-actions", ".row-list"]) {
      expect(document.querySelector(selector)).toBeNull();
    }
  });

  it("clicking the add capsule reveals the input pill", () => {
    render();
    const add = document.querySelector<HTMLButtonElement>(".vocab-cap-add");
    expect(add).not.toBeNull();
    act(() => add?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(document.querySelector(".vocab-cap-input input")).not.toBeNull();
  });

  it("Enter in the add input saves the term via the resource", async () => {
    render();
    act(() => {
      document
        .querySelector<HTMLButtonElement>(".vocab-cap-add")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const input = document.querySelector<HTMLInputElement>(".vocab-cap-input input");
    expect(input).not.toBeNull();
    act(() => {
      nativeSetValue(input!, "GraphQL");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      input!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await vi.waitFor(() =>
      expect(saveDictionaryEntry).toHaveBeenCalledWith(null, "GraphQL"),
    );
  });

  it("deleting a capsule confirms then calls the delete IPC", async () => {
    model.dictionary = [entry({ id: "d7", term: "Soto" })];
    render();
    const del = document.querySelector<HTMLButtonElement>(".vocab-cap .vocab-cap-del");
    expect(del).not.toBeNull();
    act(() => del?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await vi.waitFor(() => expect(confirmDialog).toHaveBeenCalled());
    await vi.waitFor(() =>
      expect(deleteDictionaryEntry).toHaveBeenCalledWith("d7"),
    );
  });
});
