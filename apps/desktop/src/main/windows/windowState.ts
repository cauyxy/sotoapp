import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app, screen, type BrowserWindow, type Rectangle } from "electron";
import { parseWindowState, pickStartupBounds, type WindowState } from "./windowState.pure.js";

// Window size/position persistence (native windowing convention): the main
// window remembers its last frame across launches and restores onto a display
// that is still connected, clamped to a visible work area. State is a small JSON
// in app.getPath("userData") rather than the SqliteStore, so the frame can be
// read before the DB/native runtime is built and so a corrupt file degrades to
// the default size instead of taking down boot. The pure decision (clamping +
// multi-monitor fallback) lives in windowState.pure.ts and is unit-tested.

function stateFilePath(): string {
  return join(app.getPath("userData"), "window-state.json");
}

/** Read the persisted state; returns null when absent or unparseable. */
function readWindowState(): WindowState | null {
  try {
    const path = stateFilePath();
    if (!existsSync(path)) return null;
    return parseWindowState(JSON.parse(readFileSync(path, "utf8")) as unknown);
  } catch (error) {
    console.warn(`[main] window-state read failed: ${(error as Error).message}`);
    return null;
  }
}

function writeWindowState(state: WindowState): void {
  try {
    const path = stateFilePath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(state), "utf8");
  } catch (error) {
    console.warn(`[main] window-state write failed: ${(error as Error).message}`);
  }
}

/**
 * Resolve the bounds to open the main window at, reading the persisted state and
 * validating it against the live displays. Touches Electron (`screen`/`app`),
 * delegating the pure decision to pickStartupBounds.
 */
export function resolveMainWindowBounds(): {
  bounds: Rectangle;
  maximized: boolean;
} {
  const state = readWindowState();
  const displays = screen.getAllDisplays().map((d) => ({ workArea: d.workArea }));
  return {
    bounds: pickStartupBounds(state, displays),
    maximized: state?.maximized === true,
  };
}

/**
 * Persist a window's frame on resize/move (debounced) and on close. Uses
 * getNormalBounds() so a maximized/minimized window still records its restorable
 * frame, and stores the maximized flag separately.
 */
export function trackWindowState(win: BrowserWindow): void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const capture = (): void => {
    if (win.isDestroyed()) return;
    const bounds = win.getNormalBounds();
    writeWindowState({
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      maximized: win.isMaximized(),
    });
  };

  const scheduleSave = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(capture, 400);
    // Don't let the debounce timer keep the process alive on quit.
    if (typeof timer.unref === "function") timer.unref();
  };

  win.on("resize", scheduleSave);
  win.on("move", scheduleSave);
  win.on("close", () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    capture();
  });
}
