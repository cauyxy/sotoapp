// Main-window preload. MUST be fully self-contained: a sandboxed preload
// cannot `require` sibling chunk files, so this file imports nothing shared
// (no @soto/core) to keep electron-vite from code-splitting it. The explicit
// command allowlist mirrors @soto/ipc's COMMAND_POLICY — the main-side
// IpcRouter is the validating source of truth, so this list only governs which
// convenience methods are exposed on window.soto.
import { contextBridge, ipcRenderer } from "electron";
import { MAIN_COMMANDS } from "./index.commands.js";

// Type-only import: fully erased at compile time, so it pulls NO @soto/core /
// @soto/ipc code into this self-contained preload bundle (see file header). It
// exists solely to make the hand-maintained MAIN_COMMANDS list below a compile
// error if it ever drifts from the authoritative @soto/ipc COMMAND_POLICY.
import type { CommandName } from "@soto/ipc";

const IPC_PREFIX = "soto:";
const VOICE_RUNTIME_EVENT = "soto://voice-runtime";
const CAPTURE_CONTROL_EVENT = "soto://capture-control";
const HOTKEY_CAPTURE_BEGIN_CHANNEL = "soto://hotkey-capture/begin";
const HOTKEY_CAPTURE_END_CHANNEL = "soto://hotkey-capture/end";
const HOTKEY_CAPTURE_KEY_EVENT = "soto://hotkey-capture/key";
const PERMISSION_UPDATED_EVENT = "permission://updated";
const MENU_ACTION_EVENT = "soto://menu-action";
const WINDOW_THEME_EVENT = "soto://set-theme";

// Mirrors COMMAND_POLICY (27 commands). Kept in sync by the compile-time guard
// below — a drift from the authoritative CommandName set fails `tsc`.
// Compile-time drift guard (defense in depth, since the main-side IpcRouter is
// the validating source of truth). The main window may invoke every command, so
// MAIN_COMMANDS must equal @soto/ipc's full CommandName set EXACTLY: a missing
// or extra entry makes one of these two assignments fail `tsc`, forcing the
// literal back in sync with COMMAND_POLICY rather than relying on the comment.
// Tuple-wrapped so the union check does NOT distribute (a distributive
// conditional collapses the `never` branch away in a union and would pass even
// on drift).
type AssertExtends<Sub, Super> = [Sub] extends [Super] ? true : never;
const _mainCommandsAreValid: AssertExtends<(typeof MAIN_COMMANDS)[number], CommandName> = true;
const _mainCommandsAreComplete: AssertExtends<CommandName, (typeof MAIN_COMMANDS)[number]> = true;
void _mainCommandsAreValid;
void _mainCommandsAreComplete;

const api: Record<string, unknown> = {};
for (const command of MAIN_COMMANDS) {
  api[command] = (args?: unknown) => ipcRenderer.invoke(`${IPC_PREFIX}${command}`, args);
}
api.setWindowTheme = (theme: unknown) => {
  ipcRenderer.send(WINDOW_THEME_EVENT, theme);
};
api.platform = process.platform;
api.onVoiceRuntime = (cb: (payload: unknown) => void) => {
  const listener = (_event: unknown, payload: unknown) => cb(payload);
  ipcRenderer.on(VOICE_RUNTIME_EVENT, listener);
  return () => ipcRenderer.removeListener(VOICE_RUNTIME_EVENT, listener);
};
// main -> renderer capture control (begin/cancel mic capture for a session).
api.onCaptureControl = (cb: (payload: unknown) => void) => {
  const listener = (_event: unknown, payload: unknown) => cb(payload);
  ipcRenderer.on(CAPTURE_CONTROL_EVENT, listener);
  return () => ipcRenderer.removeListener(CAPTURE_CONTROL_EVENT, listener);
};
api.beginHotkeyCapture = () => ipcRenderer.invoke(HOTKEY_CAPTURE_BEGIN_CHANNEL);
api.endHotkeyCapture = (sessionId: number) =>
  ipcRenderer.invoke(HOTKEY_CAPTURE_END_CHANNEL, sessionId);
api.onHotkeyCaptureKey = (cb: (payload: unknown) => void) => {
  const listener = (_event: unknown, payload: unknown) => cb(payload);
  ipcRenderer.on(HOTKEY_CAPTURE_KEY_EVENT, listener);
  return () => ipcRenderer.removeListener(HOTKEY_CAPTURE_KEY_EVENT, listener);
};
api.onPermissionUpdated = (cb: (payload: unknown) => void) => {
  const listener = (_event: unknown, payload: unknown) => cb(payload);
  ipcRenderer.on(PERMISSION_UPDATED_EVENT, listener);
  return () => ipcRenderer.removeListener(PERMISSION_UPDATED_EVENT, listener);
};
api.onMenuAction = (cb: (payload: unknown) => void) => {
  const listener = (_event: unknown, payload: unknown) => cb(payload);
  ipcRenderer.on(MENU_ACTION_EVENT, listener);
  return () => ipcRenderer.removeListener(MENU_ACTION_EVENT, listener);
};

try {
  contextBridge.exposeInMainWorld("soto", api);
  // Visible in the RENDERER devtools console if the preload actually ran.
  console.log("[preload] window.soto exposed with", Object.keys(api).length, "methods");
} catch (err) {
  console.error("[preload] exposeInMainWorld failed:", err);
}
