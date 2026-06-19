// Pure (Electron-free) window-state logic, split out from windowState.ts so the
// multi-monitor clamping is unit-testable in the node vitest env without an
// Electron runtime (the rest of windowState.ts touches `app`/`screen`/`fs`).

/** Rectangle shape mirroring Electron's `Rectangle` (kept dependency-free). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Default main-window frame when nothing valid is persisted. */
export const DEFAULT_MAIN_BOUNDS: Rect = { x: 0, y: 0, width: 980, height: 720 };

/** Minimum size for the main window; prevents the fixed sidebar + page padding from collapsing. */
export const MAIN_WINDOW_MIN_SIZE = { width: 900, height: 600 };

/** Persisted shape. `x`/`y` are absent on first run (centered fallback). */
export interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized: boolean;
}

/** Minimal display shape needed for clamping (subset of Electron's Display). */
export interface DisplayLike {
  workArea: Rect;
}

/** A persisted frame is usable only if it has finite, positive dimensions. */
function hasSaneSize(state: WindowState | null): state is WindowState {
  return (
    state !== null &&
    Number.isFinite(state.width) &&
    Number.isFinite(state.height) &&
    state.width > 0 &&
    state.height > 0
  );
}

/** True when two rectangles share any visible area (strict overlap, not touch). */
function intersects(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/**
 * Decide the startup frame from the persisted state and the currently connected
 * displays. Pure (no Electron/IO) so the multi-monitor logic is unit-testable.
 *
 * - No/invalid state, or zero displays -> the default size, centered (no x/y).
 * - A saved frame is honored only if it still intersects some display work area
 *   (a monitor that was unplugged would otherwise place the window off-screen);
 *   otherwise the saved SIZE is kept but centered on the primary work area.
 * - The returned size is clamped to the chosen display so an oversized saved
 *   frame can't exceed the visible work area.
 */
export function pickStartupBounds(
  state: WindowState | null,
  displays: readonly DisplayLike[],
): Rect {
  if (!hasSaneSize(state) || displays.length === 0) {
    return { ...DEFAULT_MAIN_BOUNDS };
  }

  const primary = displays[0]!.workArea;
  const hasPosition = Number.isFinite(state.x) && Number.isFinite(state.y);

  // Only trust a saved position that still lands on a connected display.
  if (hasPosition) {
    const saved: Rect = {
      x: state.x!,
      y: state.y!,
      width: state.width,
      height: state.height,
    };
    const host = displays.find((d) => intersects(saved, d.workArea));
    if (host !== undefined) {
      return {
        x: saved.x,
        y: saved.y,
        width: Math.min(saved.width, host.workArea.width),
        height: Math.min(saved.height, host.workArea.height),
      };
    }
  }

  // Position is missing or stale: keep the size (clamped) and center on primary.
  const width = Math.min(state.width, primary.width);
  const height = Math.min(state.height, primary.height);
  return {
    x: Math.round(primary.x + (primary.width - width) / 2),
    y: Math.round(primary.y + (primary.height - height) / 2),
    width,
    height,
  };
}

/** Coerce an arbitrary parsed JSON value into a WindowState, or null if invalid. */
export function parseWindowState(parsed: unknown): WindowState | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj["width"] !== "number" || typeof obj["height"] !== "number") return null;
  return {
    width: obj["width"],
    height: obj["height"],
    x: typeof obj["x"] === "number" ? obj["x"] : undefined,
    y: typeof obj["y"] === "number" ? obj["y"] : undefined,
    maximized: obj["maximized"] === true,
  };
}
