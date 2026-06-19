import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  BrowserWindow,
  Menu,
  nativeTheme,
  shell,
  type BrowserWindowConstructorOptions,
} from "electron";
import { contextMenuRoles } from "./contextMenuPolicy.pure.js";
import { externalOpenTarget } from "./externalLink.pure.js";
import { overlaySymbolColor } from "./windowChrome.pure.js";
import { resolveMainWindowBounds, trackWindowState } from "./windowState.js";
import { MAIN_WINDOW_MIN_SIZE } from "./windowState.pure.js";

// electron-vite builds main/preload as CommonJS, so __dirname is available.
const rendererUrl = process.env["ELECTRON_RENDERER_URL"];

const mainPreload = join(__dirname, "../preload/index.js");
const capsulePreload = join(__dirname, "../preload/capsule.js");
const appIcon = join(__dirname, "../renderer/soto-icon.png");
// Keep in sync with CSS --soto-chrome-top, which must stay >= this height.
const OVERLAY_H = 36;
console.log("[main] __dirname =", __dirname);
console.log("[main] main preload =", mainPreload, "exists:", existsSync(mainPreload));
console.log("[main] capsule preload =", capsulePreload, "exists:", existsSync(capsulePreload));

// Security baseline shared by every window (plan §5): renderer is fully
// isolated and sandboxed, no node integration, in-window navigation away from
// the renderer origin is refused. A new-window request (an `<a target="_blank">`
// in our own trusted bundle) never opens a BrowserWindow; an https target is
// handed to the OS browser instead so first-party CTAs like "get an API key"
// work without a bespoke IPC channel.
function hardenWindow(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    const target = externalOpenTarget(url);
    if (target !== null) void shell.openExternal(target);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    const allowed = rendererUrl !== undefined && url.startsWith(rendererUrl);
    if (!allowed) event.preventDefault();
  });
  // Fires when a preload script fails to load or throws — the decisive signal.
  win.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error(`[main] PRELOAD ERROR (${preloadPath}):`, error);
  });
}

function loadRoute(win: BrowserWindow, route: "index" | "capsule"): void {
  if (rendererUrl !== undefined) {
    void win.loadURL(route === "index" ? rendererUrl : `${rendererUrl}/${route}.html`);
  } else {
    void win.loadFile(join(__dirname, `../renderer/${route}.html`));
  }
}

// Opaque Windows window backing, matched to the renderer's --soto-bg per
// appearance (tokens.css — keep in sync). Windows uses an opaque backing rather
// than mica: a translucent material window makes DWM cast a dirty dark outer
// halo whenever the OS "transparency effects" are off, with no reliable
// per-window probe for that. macOS keeps its vibrancy path.
function windowsBackdropColor(): string {
  return nativeTheme.shouldUseDarkColors ? "#161414" : "#f5f3ee";
}

export function applyOverlayTheme(win: BrowserWindow | null): void {
  if (process.platform !== "win32" || win === null || win.isDestroyed()) return;
  win.setBackgroundColor(windowsBackdropColor());
  win.setTitleBarOverlay({
    color: "#00000000",
    symbolColor: overlaySymbolColor(nativeTheme.shouldUseDarkColors),
    height: OVERLAY_H,
  });
}

/**
 * Per-platform native window material so the top-level window reads as an OS
 * window rather than a flat web page in a frame (native-feel Tenet 1):
 *  - macOS: an `under-window` vibrancy kept `active` so it doesn't grey out when
 *    the window loses key focus; the renderer's translucent wash sits over it.
 *  - Windows: an opaque themed backing (windowsBackdropColor). Mica was tried
 *    here, but a translucent material window makes DWM cast a dirty dark outer
 *    halo whenever the OS "transparency effects" are off (no reliable per-window
 *    probe exists), so Windows stays opaque — the renderer correspondingly flips
 *    to the solid wash via <html data-window-surface="opaque"> (see App.tsx).
 */
function windowMaterialOptions(): BrowserWindowConstructorOptions {
  if (process.platform === "darwin") {
    return {
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 16, y: 15 },
      vibrancy: "under-window",
      visualEffectState: "active",
      backgroundColor: "#00000000",
    };
  }
  if (process.platform === "win32") {
    return {
      titleBarStyle: "hidden",
      titleBarOverlay: {
        color: "#00000000",
        symbolColor: overlaySymbolColor(nativeTheme.shouldUseDarkColors),
        height: OVERLAY_H,
      },
      backgroundColor: windowsBackdropColor(),
    };
  }
  return {};
}

export function createMainWindow(): BrowserWindow {
  // Restore the last frame, validated against the connected displays; falls back
  // to the 980x720 default on first run or a corrupt/off-screen saved frame.
  const { bounds, maximized } = resolveMainWindowBounds();

  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: MAIN_WINDOW_MIN_SIZE.width,
    minHeight: MAIN_WINDOW_MIN_SIZE.height,
    show: false,
    title: "Soto",
    icon: appIcon,
    // The renderer paints its own crisp shell hairline. Native shadows around a
    // translucent material window read as a dirty outer halo against other apps.
    hasShadow: false,
    ...windowMaterialOptions(),
    webPreferences: {
      preload: mainPreload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  if (maximized) win.maximize();
  hardenWindow(win);
  win.webContents.on("context-menu", (_event, params) => {
    const roles = contextMenuRoles({
      isEditable: params.isEditable,
      selectionText: params.selectionText,
    });
    if (roles.length === 0) return;
    const menu = Menu.buildFromTemplate(roles.map((role) => ({ role })));
    menu.popup({ window: win });
  });
  // Persist size/position across launches (debounced on resize/move + on close).
  trackWindowState(win);
  win.once("ready-to-show", () => win.show());
  loadRoute(win, "index");
  return win;
}

export function createCapsuleWindow(): BrowserWindow {
  const win = new BrowserWindow({
    // Enlarged transparent overlay: the pill sits near the bottom and the Panel
    // (notifications) stacks above it. The empty area is fully click-through
    // (setIgnoreMouseEvents below), so the larger frame never intercepts clicks.
    width: 360,
    height: 200,
    show: false,
    frame: false,
    transparent: true,
    // The OS would derive a native shadow (+ rim line) from this transparent
    // window's alpha union — a milky blob around the pill/panel silhouette.
    // Shadow discipline is owned entirely by CSS.
    hasShadow: false,
    resizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    ...(process.platform === "darwin" ? { type: "panel" } : {}),
    // Non-activating overlay: shown via showInactive() and click-through by
    // default, so the target app keeps focus while the capsule appears. On
    // Windows showInactive() alone is not enough — a *focusable* always-on-top
    // window can still briefly grab the foreground HWND via moveTop()/topmost
    // re-assertion, which makes the target lose focus and forces the fragile
    // SetForegroundWindow restore path. That restore only flashes the taskbar
    // when we are not already foreground, and a browser does not reliably
    // re-focus its web input after a programmatic foreground change, so paste
    // lands nowhere. focusable:false gives the window WS_EX_NOACTIVATE so it can
    // never take activation; it still receives forwarded mouse clicks, so the
    // Panel button keeps working (the capsule has no keyboard UI). On macOS keep
    // it focusable — a non-focusable hidden window can stay offscreen even after
    // showInactive(); the type:"panel" above is the non-activating mechanism there.
    focusable: process.platform !== "win32",
    webPreferences: {
      // Least-privilege preload: only the dictation cancel/finish surface.
      preload: capsulePreload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      // The overlay animates (enter/exit keyframes) around show edges and runs
      // the level meter; throttled timers while hidden would burn keyframes
      // pre-reveal and stale the first frame.
      backgroundThrottling: false,
    },
  });
  // Rank above other topmost windows from creation so the first showInactive()
  // already has the correct level (the visibility port re-asserts this on show).
  win.setAlwaysOnTop(true, "screen-saver");
  // Join all Spaces, including the currently-active full-screen Space, before the
  // first show. On macOS this is collection behavior, so setting it only at the
  // hotkey edge can leave a hidden panel in another Space. skipTransformProcessType
  // keeps Electron from toggling the process type (and blinking the Dock icon) as
  // a side effect — the activation policy is owned by CapsuleOverlay.
  win.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });
  // The overlay is click-through by default so clicks pass to the app behind it
  // (the target app never loses the pointer). `forward: true` still delivers
  // mouse-move to the renderer, so the Panel's "知道了" button can detect hover
  // and ask main to make the window momentarily interactive
  // (capsule:set-interactive) — without that toggle the button is unclickable.
  win.setIgnoreMouseEvents(true, { forward: true });
  hardenWindow(win);
  loadRoute(win, "capsule");
  return win;
}
