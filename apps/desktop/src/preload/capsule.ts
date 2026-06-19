// Capsule-window preload. Self-contained (see preload/index.ts for why).
// Least privilege: only the dictation cancel/finish commands + the
// voice-runtime listener.
import { contextBridge, ipcRenderer } from "electron";
import { CAPSULE_COMMANDS } from "./capsule.commands.js";

// Type-only import: fully erased at compile time, so it pulls NO @soto/core /
// @soto/ipc code into this self-contained preload bundle (see file header). It
// backs the compile-time drift guard below so the hand-maintained
// CAPSULE_COMMANDS list cannot reference a command that no longer exists in
// @soto/ipc's COMMAND_POLICY.
import type { CommandName } from "@soto/ipc";

const IPC_PREFIX = "soto:";
const VOICE_RUNTIME_EVENT = "soto://voice-runtime";
const CAPTURE_CONTROL_EVENT = "soto://capture-control";
const CAPSULE_OVERLAY_EVENT = "soto://capsule-overlay";
const CAPSULE_SET_INTERACTIVE = "capsule:set-interactive";
const CAPSULE_NOTICE_DISMISSED = "capsule:notice-dismissed";
const CAPSULE_NOTICE_ACTION = "capsule:notice-action";

// Mirrors the capsule-reachable subset of COMMAND_POLICY. Kept in sync by the
// compile-time guard below — a drift from that derived subset fails `tsc`.
// Compile-time drift guard: every hand-listed capsule command must be a real
// COMMAND_POLICY command, so renaming/removing one in @soto/ipc fails `tsc`
// here. (The reverse — "did @soto/ipc add a NEW capsule-reachable command we forgot
// to mirror?" — is not type-checkable from this package: COMMAND_POLICY's
// allowedWindows are annotated `readonly WindowKind[]`, so the per-command
// "capsule" membership is widened away in its public type. The authoritative
// per-window check still lives in the main IpcRouter, which rejects a capsule
// invoking a main-only command regardless of this list.) Tuple-wrapped so the
// union check does NOT distribute (a distributive conditional collapses the
// `never` branch away and would pass even on drift).
type AssertExtends<Sub, Super> = [Sub] extends [Super] ? true : never;
const _capsuleCommandsAreValid: AssertExtends<
  (typeof CAPSULE_COMMANDS)[number],
  CommandName
> = true;
void _capsuleCommandsAreValid;

const api: Record<string, unknown> = {};
for (const command of CAPSULE_COMMANDS) {
  api[command] = (args?: unknown) => ipcRenderer.invoke(`${IPC_PREFIX}${command}`, args);
}
api.onVoiceRuntime = (cb: (payload: unknown) => void) => {
  const listener = (_event: unknown, payload: unknown) => cb(payload);
  ipcRenderer.on(VOICE_RUNTIME_EVENT, listener);
  return () => ipcRenderer.removeListener(VOICE_RUNTIME_EVENT, listener);
};
// main -> capsule capture control. The capsule's recorder subscribes to begin
// MicCapture.start() on `begin` and MicCapture.cancel() on `cancel`, then
// pushes the WAV / levels back over the capture_* commands above.
api.onCaptureControl = (cb: (payload: unknown) => void) => {
  const listener = (_event: unknown, payload: unknown) => cb(payload);
  ipcRenderer.on(CAPTURE_CONTROL_EVENT, listener);
  return () => ipcRenderer.removeListener(CAPTURE_CONTROL_EVENT, listener);
};
// main -> capsule window choreography: will-show (reset + enter) and
// will-hide { in_ms, exit } (time the exit to end at the hide instant).
api.onCapsuleOverlay = (cb: (payload: unknown) => void) => {
  const listener = (_event: unknown, payload: unknown) => cb(payload);
  ipcRenderer.on(CAPSULE_OVERLAY_EVENT, listener);
  return () => ipcRenderer.removeListener(CAPSULE_OVERLAY_EVENT, listener);
};

// Renderer → main: toggle whether the (click-through) capsule window captures the
// mouse, so the Panel's dismiss button is clickable on hover. Fire-and-forget;
// main validates the sender is the capsule window and the payload is a boolean.
api.setCapsuleInteractive = (interactive: boolean) =>
  ipcRenderer.send(CAPSULE_SET_INTERACTIVE, interactive);

// Renderer → main: the user dismissed the Panel notice (Got it / strip click).
// Fire-and-forget event fact — main owns the policy (it expedites a pending
// window hide; a strict no-op while a recording session is live).
api.noticeDismissed = () => ipcRenderer.send(CAPSULE_NOTICE_DISMISSED);
api.noticeAction = (id: unknown) => ipcRenderer.send(CAPSULE_NOTICE_ACTION, id);

contextBridge.exposeInMainWorld("soto", api);
