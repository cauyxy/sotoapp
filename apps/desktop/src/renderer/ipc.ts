// Renderer IPC adapter — thin, typed wrappers over the window.soto bridge.
// Pages call these instead of window.soto.<command> directly so the call sites
// get @soto/core DTO types and a single place to evolve argument shapes.
//
// The preload exposes one untyped method per allowlisted command (see
// src/preload/index.ts); this module is the typed seam. It must NOT import the
// main process or zod — only @soto/core *types*.

import type {
  AppModel,
  AppSettings,
  CaptureStartedRequestSchema,
  ConfirmDialogSchema,
  CreateModeRequestSchema,
  DictionaryEntry,
  Health,
  HotkeyCaptureBeginResult,
  HotkeyCaptureKey,
  MicrophoneDevice,
  Mode,
  PermissionPane,
  PermissionStatus,
  ProviderConfig,
  ProviderConfigRequest,
  ProviderTestResult,
  RefreshReason,
  PushCaptureAudioRequestSchema,
  PushCaptureLevelRequestSchema,
  ReportCaptureErrorRequestSchema,
  SaveAppSettingsRequestSchema,
  SaveDictionaryEntryRequestSchema,
  SaveModeRequestSchema,
  SaveProviderConfigRequestSchema,
  TestProviderRequestSchema,
} from "@soto/core";
import type { Theme } from "./shared/theme";

// Inferred-output of a zod schema WITHOUT importing zod's value namespace (it is
// not a direct dependency of this package, so a bare `import "zod"` does not
// resolve under the renderer's bundler resolution). `z.infer<S>` is defined as
// `S["_output"]`, the schema's phantom output type, so reading that member gives
// the same wire-request DTO while keeping the dependency type-only + transitive.
type InferReq<S extends { _output: unknown }> = S["_output"];

// The cross-process DTOs (request + response shapes) are canonical in
// @soto/core — re-exported here so renderer modules keep one import seam.
// TestProviderResult is the historical renderer alias for ProviderTestResult.
export type {
  AppModel,
  Health,
  MicrophoneDevice,
  PermissionPane,
  PermissionStatus,
  ProviderConfigRequest,
  RefreshReason,
  SupportedProvider,
  SupportedProvidersResponse,
} from "@soto/core";
export type TestProviderResult = ProviderTestResult;

// --- Command request/response type map (single source of truth) -----------
//
// One entry per @soto/core command. The REQUEST side is derived from the core
// zod schemas (z.infer) so the wire-argument shape can never drift from the
// trust-boundary validator; `void` marks the no-argument commands (NoArgsSchema
// is z.void()). The RESPONSE side reuses the DTOs above / @soto/core output
// types; `unknown` is kept for the handlers whose return is opaque to the
// renderer (fire-and-forget acks, settings-pane side effects), matching the
// pre-existing typed-wrapper surface. env.d.ts derives the window.soto bridge
// signature from this map, and the wrappers below are typed against it — so
// there is exactly one place to evolve a command's argument/result shape.
export interface CommandIO {
  health: { req: void; res: Health };
  get_app_model: { req: { reason: RefreshReason } | undefined; res: AppModel };
  get_app_settings: { req: void; res: AppSettings };
  save_app_settings: { req: InferReq<typeof SaveAppSettingsRequestSchema>; res: AppSettings };
  list_microphone_devices: { req: void; res: MicrophoneDevice[] };
  list_permission_statuses: { req: void; res: PermissionStatus[] };
  open_permission_settings: { req: { pane: PermissionPane }; res: boolean };
  request_permission_authorization: { req: { pane: PermissionPane }; res: unknown };
  is_accessibility_trusted: { req: void; res: boolean };
  request_accessibility_permission: { req: void; res: unknown };
  save_mode: { req: InferReq<typeof SaveModeRequestSchema>; res: Mode };
  create_mode: { req: InferReq<typeof CreateModeRequestSchema>; res: Mode };
  delete_mode: { req: { mode_id: string }; res: void };
  delete_history_record: { req: { history_id: string }; res: unknown };
  clear_history: { req: void; res: unknown };
  confirm_dialog: { req: InferReq<typeof ConfirmDialogSchema>; res: boolean };
  save_dictionary_entry: {
    req: InferReq<typeof SaveDictionaryEntryRequestSchema>;
    res: DictionaryEntry;
  };
  delete_dictionary_entry: { req: { entry_id: string }; res: unknown };
  cancel_active_voice_runtime: { req: void; res: unknown };
  finish_active_voice_runtime: { req: void; res: unknown };
  save_provider_config: {
    req: InferReq<typeof SaveProviderConfigRequestSchema>;
    res: ProviderConfig;
  };
  test_provider_config: { req: InferReq<typeof TestProviderRequestSchema>; res: TestProviderResult };
  delete_provider_config: { req: { config_id: string }; res: void };
  capture_started: { req: InferReq<typeof CaptureStartedRequestSchema>; res: unknown };
  push_capture_audio: { req: InferReq<typeof PushCaptureAudioRequestSchema>; res: unknown };
  push_capture_level: { req: InferReq<typeof PushCaptureLevelRequestSchema>; res: unknown };
  report_capture_error: { req: InferReq<typeof ReportCaptureErrorRequestSchema>; res: unknown };
  repair_data: { req: void; res: unknown };
}

// --- Dev-only IPC tracer ---------------------------------------------------
//
// In a dev build (import.meta.env.DEV) every command round-trip is timed and
// logged as { requestId, kind, durationMs } so the IPC hot path is observable
// in the renderer devtools console. It is a transparent Proxy over the raw
// bridge: command methods are wrapped to measure their promise; listeners and
// side-channel senders pass through untouched because they are not
// request/response commands. In production the branch is statically false, so
// Vite tree-shakes the Proxy away.
let nextRequestId = 0;
const PASSTHROUGH_KEYS = new Set<PropertyKey>([
  "setWindowTheme",
  "onVoiceRuntime",
  "onCaptureControl",
  "onHotkeyCaptureKey",
  "onPermissionUpdated",
  "onMenuAction",
]);

function traceBridge(raw: Window["soto"]): Window["soto"] {
  return new Proxy(raw, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver) as unknown;
      if (typeof value !== "function" || PASSTHROUGH_KEYS.has(key)) {
        return value;
      }
      const fn = value as (...args: unknown[]) => unknown;
      return (...args: unknown[]): unknown => {
        const requestId = nextRequestId++;
        const kind = String(key);
        const startedAt = performance.now();
        const result = fn.apply(target, args);
        if (result instanceof Promise) {
          return result.finally(() => {
            const durationMs = performance.now() - startedAt;
            console.debug("[soto-ipc]", { requestId, kind, durationMs });
          });
        }
        return result;
      };
    },
  });
}

function bridge(): Window["soto"] {
  if (typeof window === "undefined" || typeof window.soto === "undefined") {
    throw new Error("window.soto bridge is unavailable (preload did not load)");
  }
  return import.meta.env.DEV ? traceBridge(window.soto) : window.soto;
}

/** Is the preload bridge present? Renderers gate boot on this. */
export function hasBridge(): boolean {
  return typeof window !== "undefined" && typeof window.soto !== "undefined";
}

// --- System / health ------------------------------------------------------

export const health = (): Promise<Health> => bridge().health();

// The optional reason scopes the main-side refresh (e.g. a settings save skips
// re-enumerating microphones); omitting it is a conservative full read.
export const getAppModel = (reason?: RefreshReason): Promise<AppModel> =>
  bridge().get_app_model(reason === undefined ? undefined : { reason });

export const setWindowTheme = (theme: Theme): void => {
  bridge().setWindowTheme(theme);
};

export const windowPlatform = (): string => bridge().platform;

// Clear the SotoDB and relaunch — recovery for the dead-end "设置命令不可用"
// screen when get_app_model failed (corrupt db / unreadable secrets). The main
// process wipes + restarts, so this promise normally never resolves.
export const repairData = (): Promise<unknown> => bridge().repair_data();

export function rendererOs(): "mac" | "win" {
  const platform = hasBridge()
    ? windowPlatform()
    : typeof document !== "undefined"
      ? document.documentElement.getAttribute("data-platform") ?? ""
      : "";
  return platform.startsWith("win") ? "win" : "mac";
}

// --- Settings -------------------------------------------------------------

export const getAppSettings = (): Promise<AppSettings> => bridge().get_app_settings();

export const saveAppSettings = (settings: AppSettings): Promise<AppSettings> =>
  bridge().save_app_settings({ settings });

// --- Permissions / microphone --------------------------------------------

export const listMicrophoneDevices = (): Promise<MicrophoneDevice[]> =>
  bridge().list_microphone_devices();

export const listPermissionStatuses = (): Promise<PermissionStatus[]> =>
  bridge().list_permission_statuses();

export const openPermissionSettings = (pane: PermissionPane): Promise<boolean> =>
  bridge().open_permission_settings({ pane });

export const requestPermissionAuthorization = (pane: PermissionPane): Promise<unknown> =>
  bridge().request_permission_authorization({ pane });

export const isAccessibilityTrusted = (): Promise<boolean> =>
  bridge().is_accessibility_trusted();

export const requestAccessibilityPermission = (): Promise<unknown> =>
  bridge().request_accessibility_permission();

// --- Modes ----------------------------------------------------------------

// save_mode's zod schema (SaveModeRequestSchema) REQUIRES hotkey_conflict_policy,
// so it must be on the wire or the main router rejects with invalid_input.
// "steal" matches the old app's default (the new mode wins a chord conflict).
export const saveMode = (
  mode: Mode,
  hotkeyConflictPolicy: "reject" | "steal" = "steal",
): Promise<Mode> =>
  bridge().save_mode({
    request: { mode, hotkey_conflict_policy: hotkeyConflictPolicy },
  });

// Create a user mode (server mints id + display_order + built_in:false).
export const createMode = (name: string): Promise<Mode> =>
  bridge().create_mode({ request: { name } });

// Delete a user mode (no-op for built-ins, enforced main-side).
export const deleteMode = (modeId: string): Promise<void> =>
  bridge().delete_mode({ mode_id: modeId }) as Promise<void>;

// --- History --------------------------------------------------------------

export const deleteHistoryRecord = (historyId: string): Promise<unknown> =>
  bridge().delete_history_record({ history_id: historyId });

export const clearHistory = (): Promise<unknown> => bridge().clear_history();

// --- Native dialogs -------------------------------------------------------

// Native OS confirmation dialog (main-window only). Resolves true iff the user
// confirmed; used to gate irreversible actions (e.g. clear-all history).
export const confirmDialog = (
  opts: InferReq<typeof ConfirmDialogSchema>,
): Promise<boolean> => bridge().confirm_dialog(opts) as Promise<boolean>;

// --- Dictionary -----------------------------------------------------------

export const saveDictionaryEntry = (
  id: string | null,
  term: string,
): Promise<DictionaryEntry> =>
  bridge().save_dictionary_entry({ request: { id, term } });

export const deleteDictionaryEntry = (entryId: string): Promise<unknown> =>
  bridge().delete_dictionary_entry({ entry_id: entryId });

// --- Providers ------------------------------------------------------------

// Create (config_id: null) or update a provider config. Reads come from the
// AppModel (providerCatalog / providerConfigs) — there are no per-list commands.
export const saveProviderConfig = (
  request: ProviderConfigRequest & { config_id: string | null },
): Promise<ProviderConfig> =>
  bridge().save_provider_config({ request });

export const testProviderConfig = (
  configId: string,
  sample: string | null = null,
): Promise<TestProviderResult> =>
  bridge().test_provider_config({
    request: { config_id: configId, sample },
  });

// Delete a provider config. Engine-slot settings pointing at the deleted id are
// left dangling on purpose (resolvers report missing_provider — no silent
// re-pointing, engine spec §7.1); the 模型 page refreshes the AppModel after.
export const deleteProviderConfig = (configId: string): Promise<void> =>
  bridge().delete_provider_config({ config_id: configId });

// --- Voice runtime / capture (listeners) ----------------------------------

export const onVoiceRuntime = (cb: (payload: unknown) => void): (() => void) =>
  bridge().onVoiceRuntime(cb);

export const onCaptureControl = (cb: (payload: unknown) => void): (() => void) =>
  bridge().onCaptureControl(cb);

export const beginHotkeyCapture = (): Promise<HotkeyCaptureBeginResult> =>
  bridge().beginHotkeyCapture();

export const endHotkeyCapture = (sessionId: number): Promise<void> =>
  bridge().endHotkeyCapture(sessionId);

export const onHotkeyCaptureKey = (
  cb: (payload: HotkeyCaptureKey) => void,
): (() => void) => bridge().onHotkeyCaptureKey(cb);

export const onPermissionUpdated = (cb: (payload: unknown) => void): (() => void) =>
  bridge().onPermissionUpdated(cb);

export const onMenuAction = (cb: (payload: unknown) => void): (() => void) =>
  bridge().onMenuAction(cb);
