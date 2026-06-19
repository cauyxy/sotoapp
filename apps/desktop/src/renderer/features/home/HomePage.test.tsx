// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { HistoryRecord, Mode } from "@soto/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HomePage } from "./HomePage";

const store = vi.hoisted(() => ({
  setView: vi.fn(),
}));

vi.mock("../../i18n/context", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("../../store/appStore", () => ({
  useAppStore: (selector: (state: { setView: () => void }) => unknown) =>
    selector({ setView: store.setView }),
}));

vi.mock("../../shared/chordDisplay", () => ({
  prettyChord: () => "⌘L",
}));

const model = vi.hoisted(() => ({
  readiness: { state: "ready" } as { state: string; blockers?: unknown[] },
  modes: [] as Mode[],
  activeModeId: "m1" as string | null,
  recentHistory: [] as HistoryRecord[],
}));

vi.mock("../../store/appResources", () => ({
  useAppModel: () => model,
}));

function mode(): Mode {
  return {
    id: "m1",
    name: "Omni",
    prompt_body: "",
    hotkey: { chord: "LeftMeta+L" },
    display_order: 0,
    built_in: true,
    created_at: 1n,
    updated_at: 1n,
  } as unknown as Mode;
}

function historyRecord(): HistoryRecord {
  return {
    id: "h1",
    mode_id: "m1",
    raw_text: "raw",
    processed_text: "Hello there.",
    target_app_name: "Notes",
    target_app: "com.apple.Notes",
    created_at: BigInt(Date.now()),
    char_count: 1248,
    speaking_duration_ms: 6200n,
    status: "completed",
  } as unknown as HistoryRecord;
}

let root: Root | null = null;

function renderHome(): void {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(React.createElement(HomePage));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }).IS_REACT_ACT_ENVIRONMENT = true;
  model.readiness = { state: "ready" };
  model.modes = [mode()];
  model.activeModeId = "m1";
  model.recentHistory = [historyRecord()];
});

afterEach(() => {
  if (root !== null) {
    act(() => root?.unmount());
    root = null;
  }
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("HomePage", () => {
  it("keeps the retired Home DOM absent", () => {
    renderHome();
    const retiredSelectors = [
      `.home-${"inlay"}`,
      `.home-${"capsule"}-${"replica"}`,
      `.home-${"mode"}-${"chip"}`,
    ];
    for (const selector of retiredSelectors) {
      expect(document.querySelector(selector)).toBeNull();
    }
  });

  it("folds the hotkey hint into the status row", () => {
    renderHome();
    const status = document.querySelector(".home-status-row .home-status-text");
    const badge = status?.querySelector(".hotkey-badge");
    expect(status?.textContent).toBe("home.gesture.hold ⌘L home.gesture.speak");
    expect(status?.textContent).toContain("home.gesture.hold");
    expect(badge?.textContent).toBe("⌘L");
    expect(status?.textContent).toContain("home.gesture.speak");
  });

  it("promotes today's stats into a three-cell number strip", () => {
    renderHome();
    const cells = Array.from(document.querySelectorAll(".home-stats > .home-stat"));
    const values = Array.from(
      document.querySelectorAll(".home-stats .home-stat-value"),
    );
    const labels = Array.from(
      document.querySelectorAll(".home-stats .home-stat-label"),
    );
    expect(cells).toHaveLength(3);
    for (const cell of cells) {
      expect(cell.querySelector(".home-stat-value")).not.toBeNull();
      expect(cell.querySelector(".home-stat-label")).not.toBeNull();
    }
    expect(values).toHaveLength(3);
    expect(labels).toHaveLength(3);
    expect(values[0]?.textContent).toBe("1,248");
    expect(values[1]?.textContent).toBe("1");
    expect(values[2]?.textContent).toBe("6.2s");
  });

  it("still renders the recent history rows", () => {
    renderHome();
    expect(document.querySelectorAll(".recent-card .row")).toHaveLength(1);
  });

  it("routes provider blocker fixes to Models", () => {
    model.readiness = { state: "blocked", blockers: [{ kind: "missing_provider" }] };
    renderHome();

    const fix = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "home.readiness.fix",
    );
    expect(fix).toBeDefined();

    act(() => {
      fix?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(store.setView).toHaveBeenCalledWith("Models");
  });
});
