import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAIN_BOUNDS,
  MAIN_WINDOW_MIN_SIZE,
  parseWindowState,
  pickStartupBounds,
  type DisplayLike,
  type WindowState,
} from "./windowState.pure.js";

// Pure window-frame restore logic (multi-monitor clamping + corrupt-state
// fallback). No Electron runtime — mirrors how the other main-process tests run
// "minus Electron".

const primary: DisplayLike = { workArea: { x: 0, y: 0, width: 1440, height: 900 } };
// A secondary display to the right, e.g. an external monitor.
const secondary: DisplayLike = { workArea: { x: 1440, y: 0, width: 1920, height: 1080 } };

describe("main window size constants", () => {
  it("keeps the minimum size aligned to the supported desktop shell", () => {
    expect(MAIN_WINDOW_MIN_SIZE).toEqual({ width: 900, height: 600 });
    expect(DEFAULT_MAIN_BOUNDS.width).toBeGreaterThanOrEqual(MAIN_WINDOW_MIN_SIZE.width);
    expect(DEFAULT_MAIN_BOUNDS.height).toBeGreaterThanOrEqual(MAIN_WINDOW_MIN_SIZE.height);
  });
});

describe("pickStartupBounds", () => {
  it("returns the default size when no state is persisted", () => {
    expect(pickStartupBounds(null, [primary])).toEqual(DEFAULT_MAIN_BOUNDS);
  });

  it("returns the default size when there are no connected displays", () => {
    const state: WindowState = { width: 1000, height: 700, x: 10, y: 10, maximized: false };
    expect(pickStartupBounds(state, [])).toEqual(DEFAULT_MAIN_BOUNDS);
  });

  it("rejects a non-positive saved size and falls back to the default", () => {
    const bad: WindowState = { width: 0, height: -5, x: 100, y: 100, maximized: false };
    expect(pickStartupBounds(bad, [primary])).toEqual(DEFAULT_MAIN_BOUNDS);
  });

  it("honors a saved frame that still lands on a connected display", () => {
    const state: WindowState = { width: 1000, height: 700, x: 200, y: 120, maximized: false };
    expect(pickStartupBounds(state, [primary])).toEqual({
      x: 200,
      y: 120,
      width: 1000,
      height: 700,
    });
  });

  it("restores onto a still-connected secondary display", () => {
    // Window was last on the external monitor (x >= 1440).
    const state: WindowState = { width: 1200, height: 800, x: 1600, y: 100, maximized: false };
    expect(pickStartupBounds(state, [primary, secondary])).toEqual({
      x: 1600,
      y: 100,
      width: 1200,
      height: 800,
    });
  });

  it("re-centers on the primary when the saved display was unplugged", () => {
    // Saved on the now-absent secondary monitor — must not open off-screen.
    const state: WindowState = { width: 1000, height: 700, x: 1600, y: 100, maximized: false };
    const result = pickStartupBounds(state, [primary]);
    expect(result.width).toBe(1000);
    expect(result.height).toBe(700);
    // Centered within the primary work area.
    expect(result.x).toBe(Math.round((1440 - 1000) / 2));
    expect(result.y).toBe(Math.round((900 - 700) / 2));
  });

  it("clamps an oversized saved frame to the hosting display work area", () => {
    const state: WindowState = { width: 5000, height: 4000, x: 10, y: 10, maximized: false };
    const result = pickStartupBounds(state, [primary]);
    expect(result.width).toBe(1440);
    expect(result.height).toBe(900);
  });

  it("centers the saved size when no position was recorded", () => {
    const state: WindowState = { width: 1000, height: 700, maximized: false };
    const result = pickStartupBounds(state, [primary]);
    expect(result.x).toBe(Math.round((1440 - 1000) / 2));
    expect(result.y).toBe(Math.round((900 - 700) / 2));
    expect(result.width).toBe(1000);
    expect(result.height).toBe(700);
  });
});

describe("parseWindowState", () => {
  it("rejects non-objects and missing dimensions", () => {
    expect(parseWindowState(null)).toBeNull();
    expect(parseWindowState(42)).toBeNull();
    expect(parseWindowState({ width: 800 })).toBeNull();
    expect(parseWindowState({ width: "800", height: 600 })).toBeNull();
  });

  it("parses a full state and coerces the maximized flag", () => {
    expect(
      parseWindowState({ width: 800, height: 600, x: 10, y: 20, maximized: true }),
    ).toEqual({ width: 800, height: 600, x: 10, y: 20, maximized: true });
  });

  it("drops a partial position (x without y) and defaults maximized to false", () => {
    expect(parseWindowState({ width: 800, height: 600, x: 10 })).toEqual({
      width: 800,
      height: 600,
      x: 10,
      y: undefined,
      maximized: false,
    });
  });
});
