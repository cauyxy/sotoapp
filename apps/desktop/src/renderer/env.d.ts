/// <reference types="vite/client" />

// The preload exposes one method per allowed command. Every signature is
// derived from the single-source-of-truth CommandIO map in ./ipc (whose request
// shapes come from @soto/core's zod schemas), so the bridge type cannot drift
// from the wire contract. This file stays a *global ambient* declaration (no
// top-level import — that would turn it into a module and stop it augmenting the
// global `Window`), so the CommandIO reference is an inline `import(...)` type.
type SotoCommandIO = import("./ipc").CommandIO;

// Per command: a no-argument command (req: void) becomes a zero-parameter
// method; everything else takes its request DTO. The result is the command's
// response DTO.
type SotoCommandMethods = {
  [K in keyof SotoCommandIO]: SotoCommandIO[K]["req"] extends void
    ? () => Promise<SotoCommandIO[K]["res"]>
    : (args: SotoCommandIO[K]["req"]) => Promise<SotoCommandIO[K]["res"]>;
};

// The full bridge: typed per-command methods plus side channels and event
// listeners (payloads stay `unknown`; the renderer narrows them at the call site).
interface SotoBridge extends SotoCommandMethods {
  platform: string;
  // renderer -> main native-theme side channel; main validates sender + payload.
  setWindowTheme(theme: import("./shared/theme").Theme): void;
  // main -> renderer voice-runtime events (level/state/...).
  onVoiceRuntime(cb: (payload: unknown) => void): () => void;
  // main -> renderer capture control (begin/cancel mic capture for a session).
  onCaptureControl(cb: (payload: unknown) => void): () => void;
  // renderer -> main hotkey binding capture process-control side channel.
  beginHotkeyCapture(): Promise<import("@soto/core").HotkeyCaptureBeginResult>;
  endHotkeyCapture(sessionId: number): Promise<void>;
  // main -> renderer key edges while hotkey binding capture is active.
  onHotkeyCaptureKey(cb: (payload: import("@soto/core").HotkeyCaptureKey) => void): () => void;
  // main -> renderer permission status updates.
  onPermissionUpdated(cb: (payload: unknown) => void): () => void;
  // main -> renderer menu actions.
  onMenuAction(cb: (payload: unknown) => void): () => void;
  // capsule renderer -> main notice primary action.
  noticeAction?(id: "copy_text" | "open_permission_settings"): void;
}

interface Window {
  soto: SotoBridge;
}
