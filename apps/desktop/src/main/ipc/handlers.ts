// Concrete handlers for the Soto IPC commands, backed by the SqliteStore (plan
// §4) and the NativeBridge. Pure validation/contract logic comes from
// @soto/core; inputs arrive already zod-validated by IpcRouter, so casts here
// are safe to the command's declared input shape. Provider api_key never
// leaves the main process — config-returning handlers emit the public
// ProviderConfig (no secret field); secrets go to the encrypted secrets table.

import {
  CANONICAL_MODE_IDS,
  listProviderDefaults,
  validateDisjoint,
  type AppSettings,
  type ConfirmDialogInput,
  type DictionaryEntry,
  type Mode,
  type ProviderConfig,
  type ProviderConfigRequest,
  type RefreshReason,
} from "@soto/core";
import type { FetchLike } from "@soto/core";
import type { CommandName, SenderContext } from "@soto/ipc";
import type { NativeBridge } from "@soto/native-bridge";
import type { SessionController } from "../voice/sessionController.js";
import { freshValidation, type SqliteStore } from "../db/store.js";
import { validateProviderConfig } from "../runtime/providerTest.js";
import { createManagedDashscopeRealtimeWebSocketFactory } from "../runtime/realtimeSocket.js";
import {
  assembleAppModel,
  type AppModel,
  type MicrophoneDevice,
} from "../runtime/appModel.js";

// MicrophoneDevice is owned by appModel.ts (it is an AppModel field); re-exported
// here so existing import sites (index.ts) keep resolving it from handlers.
export type { MicrophoneDevice };

type Handler = (input: unknown, ctx: SenderContext) => unknown | Promise<unknown>;

function newId(prefix: string): string {
  const uuid =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  return `${prefix}.${uuid}`;
}

// ProviderConfig has no api_key field — secrets live in the encrypted
// provider_secrets table and never cross to the renderer.
function publicProviderConfig(config: ProviderConfig): ProviderConfig {
  return config;
}

export interface HandlerRuntimeOptions {
  version?: string;
  listMicrophoneDevices?: () => Promise<MicrophoneDevice[]> | MicrophoneDevice[];
  // Native OS confirmation capability. Injected from index.ts (which owns
  // mainWindow + may import electron's `dialog`) so handlers.ts stays
  // electron-free and unit-testable. Resolves true iff the user confirmed.
  // Omitted in unit tests / non-GUI runtimes -> defaults to `false` so an
  // irreversible action is treated as cancelled rather than proceeding unguarded.
  showConfirmDialog?: (opts: ConfirmDialogInput) => Promise<boolean>;
  // Whether the native bridge/facilities loaded (false = stub runtime). Feeds
  // the AppModel readiness derivation (no native => hotkey/injection inert).
  // Injected from index.ts where `facilities` is known; defaults false.
  nativeRuntimeAvailable?: boolean;
  // Fired after save_mode persists, so the live HotkeyRuntime can re-bind its
  // chords immediately (no restart). Injected from index.ts (HotkeyService).
  onModesChanged?: () => void;
  // Fired after save_app_settings persists validated settings, so main-process
  // controllers can apply settings-backed OS state without a restart.
  onSettingsSaved?: (settings: AppSettings) => void;
  openPermissionSettingsFallback?: (
    pane: Parameters<NativeBridge["openPermissionSettings"]>[0],
  ) => boolean | Promise<boolean>;
  // Clear the SotoDB and relaunch. Injected from index.ts (which owns electron
  // `app` + the live store handle) so handlers.ts stays electron-free and
  // unit-testable. Omitted in unit tests -> no-op (nothing wiped/restarted).
  repairData?: () => void | Promise<void>;
}

export function createHandlers(
  store: SqliteStore,
  native: NativeBridge,
  // Optional: present in the live app, omitted in store/handler unit tests that
  // don't exercise the capture path. The 4 capture_* handlers no-op without it.
  sessionController?: SessionController,
  runtimeOptions: HandlerRuntimeOptions = {},
): Record<CommandName, Handler> {
  const version = runtimeOptions.version ?? "0.0.0-test";
  const listMicrophoneDevices =
    runtimeOptions.listMicrophoneDevices ?? (() => Promise.resolve([]));
  // No dialog capability wired -> treat every confirmation as cancelled (false)
  // so a destructive action gated on it never proceeds unprompted.
  const showConfirmDialog =
    runtimeOptions.showConfirmDialog ?? ((): Promise<boolean> => Promise.resolve(false));
  const nativeRuntimeAvailable = runtimeOptions.nativeRuntimeAvailable ?? false;
  const onModesChanged = runtimeOptions.onModesChanged ?? ((): void => {});
  const onSettingsSaved = runtimeOptions.onSettingsSaved ?? ((): void => {});
  const repairData = runtimeOptions.repairData ?? ((): void => {});

  /**
   * Modes whose hotkey chord is NOT disjoint from `chord` (shares a modifier).
   * An unparseable sibling chord is treated as never conflicting, mirroring the
   * renderer-side draft validation (modes.draft.ts).
   */
  function conflictingModes(chord: string, excludeModeId: string): Mode[] {
    return store.listModes().filter((other) => {
      if (other.id === excludeModeId || other.hotkey === null) return false;
      try {
        return validateDisjoint([chord, other.hotkey.chord]) !== null;
      } catch {
        return false;
      }
    });
  }

  function persistConfig(configId: string, req: ProviderConfigRequest): ProviderConfig {
    const now = BigInt(Date.now());
    const config: ProviderConfig = {
      config_id: configId,
      provider_id: req.provider_id,
      display_name: req.display_name,
      model: req.model,
      base_url: req.base_url,
      is_default: req.is_default,
      capability: req.capability,
      validation: freshValidation(),
      created_at: now,
      updated_at: now,
    };
    store.upsertProviderConfig(config); // preserves created_at/validation on update, flips defaults
    if (req.api_key !== null && req.api_key.length > 0) {
      store.putProviderSecrets({
        config_id: configId,
        api_key: req.api_key,
        endpoint: req.base_url,
      });
    }
    return publicProviderConfig(store.getProviderConfig(configId) ?? config);
  }

  // Microphone enumeration round-trips through the renderer (executeJavaScript)
  // — the one expensive sub-read in the model assembly. A scoped refresh reuses
  // the previous enumeration unless the cause could have changed the device
  // list (boot, permission flips) or no enumeration has happened yet; an absent
  // reason stays a conservative full read.
  let lastMicrophones: MicrophoneDevice[] | null = null;
  const MIC_REFRESH_REASONS: ReadonlySet<RefreshReason> = new Set(["initial", "permissions"]);

  return {
    health: () => ({ ok: true, version, storage_ok: true }),

    // Clear the SotoDB and relaunch. Delegates to the injected capability (which
    // closes the db + deletes files + restarts); returns undefined for the ack.
    // Destructive — the renderer entry gates it behind a native confirm.
    repair_data: async () => {
      await repairData();
      return undefined;
    },

    // Aggregated app model (plan §4.3). Reuses the handler's existing store /
    // native / mic closures; the only extra input is whether the native runtime
    // loaded. ProviderConfig still carries no api_key (the store
    // returns the public shape), so no secret crosses to the renderer.
    get_app_model: async (input): Promise<AppModel> => {
      const reason = (input as { reason: RefreshReason } | undefined)?.reason;
      const cached = lastMicrophones;
      const enumerate = cached === null || reason === undefined || MIC_REFRESH_REASONS.has(reason);
      const model = await assembleAppModel({
        store,
        listProviderDefaults,
        permissionStatuses: () => native.permissionStatuses(),
        listMicrophoneDevices: enumerate ? listMicrophoneDevices : () => cached ?? [],
        nativeRuntimeAvailable,
      });
      if (enumerate) lastMicrophones = model.microphones;
      return model;
    },

    get_app_settings: () => store.getSettings(),
    save_app_settings: (input) => {
      const saved = store.saveSettings(
        (input as { settings: Parameters<SqliteStore["saveSettings"]>[0] }).settings,
      );
      onSettingsSaved(saved);
      return saved;
    },

    list_microphone_devices: () => listMicrophoneDevices(),
    list_permission_statuses: () => native.permissionStatuses(),
    open_permission_settings: async (input) => {
      const pane = (
        input as { pane: Parameters<NativeBridge["openPermissionSettings"]>[0] }
      ).pane;
      if (native.openPermissionSettings(pane)) return true;
      return (await runtimeOptions.openPermissionSettingsFallback?.(pane)) === true;
    },
    request_permission_authorization: (input) =>
      native.requestPermission((input as { pane: Parameters<NativeBridge["requestPermission"]>[0] }).pane),
    is_accessibility_trusted: () => native.isAccessibilityTrusted(),
    request_accessibility_permission: () => native.requestAccessibilityPermission(),

    // Persist a mode, enforcing the request's hotkey_conflict_policy against
    // the OTHER modes' chords ("reject" fails the save; "steal" clears the
    // conflicting modes' hotkeys), then notify the hotkey runtime to re-bind.
    save_mode: (input) => {
      const { mode, hotkey_conflict_policy } = (
        input as {
          request: { mode: Mode; hotkey_conflict_policy: "reject" | "steal" };
        }
      ).request;
      const existing = store.getMode(mode.id);
      if (existing === null) {
        throw new Error(
          `save_mode is update-only; unknown mode id ${mode.id} (use create_mode)`,
        );
      }
      const chord = mode.hotkey?.chord;
      if (chord !== undefined) {
        const conflicts = conflictingModes(chord, mode.id);
        if (conflicts.length > 0 && hotkey_conflict_policy === "reject") {
          throw new Error(
            `hotkey conflict: "${chord}" overlaps ${conflicts.map((m) => m.id).join(", ")}`,
          );
        }
        for (const other of conflicts) {
          store.saveMode({ ...other, hotkey: null });
        }
      }
      const saved = store.saveMode({
        ...mode,
        display_order: existing.display_order,
        built_in: existing.built_in,
        created_at: existing.created_at,
      });
      onModesChanged();
      return saved;
    },

    // Create a user mode: server mints the id + ordering so the renderer cannot
    // collide with a built-in id or relabel built_in. Empty prompt_body is a
    // valid dictation mode; the renderer renames + sets prompt/hotkey via save_mode.
    create_mode: (input) => {
      const { name } = (input as { request: { name: string } }).request;
      const now = BigInt(Date.now());
      const nextOrder =
        store.listModes().reduce((max, m) => Math.max(max, m.display_order), -1) + 1;
      const saved = store.saveMode({
        id: newId("mode"),
        name,
        prompt_body: "",
        hotkey: null,
        display_order: nextOrder,
        built_in: false,
        created_at: now,
        updated_at: now,
      });
      onModesChanged();
      return saved;
    },

    // Delete a user mode. store.deleteMode no-ops on built-ins (DB trigger guards
    // too). Repoint the active mode to the always-present built-in default so
    // readiness never lands on a dangling current_mode_id. History rows keep a
    // dangling mode_id by design (no FK; the History page labels it as deleted).
    delete_mode: (input) => {
      const { mode_id } = input as { mode_id: string };
      const target = store.getMode(mode_id);
      const settings = store.getSettings();
      if (target !== null && !target.built_in && settings.current_mode_id === mode_id) {
        onSettingsSaved(
          store.saveSettings({ ...settings, current_mode_id: CANONICAL_MODE_IDS[0] }),
        );
      }
      store.deleteMode(mode_id);
      onModesChanged();
    },

    delete_history_record: (input) =>
      store.deleteHistoryRecord((input as { history_id: string }).history_id),
    clear_history: () => store.clearHistory(),

    // Native OS confirmation. Delegates to the injected capability (index.ts owns
    // the real electron `dialog`); handlers.ts imports no electron. Input is
    // zod-validated by IpcRouter to ConfirmDialogInput.
    confirm_dialog: (input) => showConfirmDialog(input as ConfirmDialogInput),

    save_dictionary_entry: (input) => {
      const { id, term } = (input as { request: { id: string | null; term: string } }).request;
      const trimmed = term.trim();
      if (id !== null) {
        const existing = store.getDictionaryEntry(id);
        if (existing) return store.saveDictionaryEntry({ ...existing, term: trimmed });
      }
      const entry: DictionaryEntry = {
        id: newId("dict"),
        term: trimmed,
        source: "user_added",
        hit_count: 0,
        last_used_at: null,
        created_at: BigInt(Date.now()),
      };
      return store.saveDictionaryEntry(entry);
    },
    delete_dictionary_entry: (input) =>
      store.deleteDictionaryEntry((input as { entry_id: string }).entry_id),

    // Capsule ✕ / ✓ buttons. These drive the SessionController (NOT the dead
    // native dictation stubs): cancel/finish the active session so this.active
    // clears and the controller stays re-entrant. No-op (controller absent or no
    // active session) in store/handler unit tests.
    cancel_active_voice_runtime: () => sessionController?.cancelActive(),
    finish_active_voice_runtime: () => sessionController?.finishActive(),

    // Capture lifecycle (renderer mic -> SessionController). Inputs arrive
    // zod-validated by IpcRouter. The controller checks session_id identity, so
    // a stale push from a previous session is safely ignored downstream.
    capture_started: (input) => {
      const { session_id } = input as { session_id: string };
      sessionController?.onCaptureStarted(session_id);
    },
    push_capture_audio: (input) => {
      const req = input as {
        session_id: string;
        wav_base64: string;
        duration_ms: number;
        peak: number;
        voiced_ms: number;
      };
      // Fire-and-forget: the long-running session pipeline emits its own
      // voice-runtime events; the IPC ack returns immediately.
      void sessionController?.onCaptureAudio({
        sessionId: req.session_id,
        wavBase64: req.wav_base64,
        durationMs: req.duration_ms,
        peak: req.peak,
        voicedMs: req.voiced_ms,
      });
    },
    push_capture_level: (input) => {
      const { session_id, level } = input as { session_id: string; level: number };
      sessionController?.onCaptureLevel(session_id, level);
    },
    report_capture_error: (input) => {
      const { session_id, message } = input as { session_id: string; message: string };
      void sessionController?.onCaptureError(session_id, message);
    },

    // Create (config_id: null) or update a provider config; reads come from
    // get_app_model (providerCatalog / providerConfigs).
    save_provider_config: (input) => {
      const req = (input as { request: ProviderConfigRequest & { config_id: string | null } }).request;
      return persistConfig(req.config_id ?? newId("config"), req);
    },
    // Real per-capability round-trip (omni/llm: reply-ok chat; asr: silent WAV
    // through the real transcribe path), using the decrypted (main-only)
    // api_key + an injected fetch. We hand the runtime's global fetch (undici on
    // Node 18+/Electron) to the validator; if no fetch is available we keep the
    // legacy stub note rather than throwing. The result is STAMPED into the
    // stored config (impl-log decision 3) so readiness + the 模型 page badges
    // stay truthful across restarts.
    test_provider_config: async (input) => {
      const { config_id } = (input as { request: { config_id: string } }).request;
      const globalFetch = (globalThis as { fetch?: unknown }).fetch;
      if (typeof globalFetch !== "function") {
        return { config_id, status: "unspecified", note: "not implemented (stub)", latency_ms: 0 };
      }
      const realtimeSockets = createManagedDashscopeRealtimeWebSocketFactory();
      const result = await validateProviderConfig(
        store,
        globalFetch as unknown as FetchLike,
        config_id,
        realtimeSockets.webSocket,
      ).finally(() => realtimeSockets.dispose());
      const existing = store.getProviderConfig(config_id);
      if (existing !== null) {
        store.updateProviderValidation(config_id, {
          ...existing.validation,
          last_validated_at: BigInt(Date.now()),
          last_validated_latency_ms: result.latency_ms,
          last_validated_status: result.status === "ok" ? "ok" : "err",
          last_validated_note: result.note.length > 0 ? result.note : null,
        });
      }
      return result;
    },

    // Delete a config. Engine-slot settings intentionally keep a dangling id —
    // the capability resolvers treat it as missing (missing_provider), so the
    // slot shows its explicit empty state. No silent re-pointing (spec §7.1).
    delete_provider_config: (input) => {
      store.deleteProviderConfig((input as { config_id: string }).config_id);
    },
  };
}
