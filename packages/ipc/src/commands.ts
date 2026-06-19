// The authoritative Soto IPC command policy: each command declares its input
// schema and the windows allowed to invoke it. This is the whitelist +
// per-window authorization the main process enforces via IpcRouter.
//
// Capsule least-privilege: the capsule window may cancel/finish dictation and
// stream capture audio/levels. Settings, permissions, and customization remain
// main-only.

import type { z } from "zod";
import type {
  AnyCommandDefinition,
  CommandDefinition,
  SenderContext,
  WindowKind,
} from "./router.js";
import {
  CaptureStartedRequestSchema,
  ConfigIdParamSchema,
  ConfirmDialogSchema,
  CreateModeRequestSchema,
  EntryIdParamSchema,
  GetAppModelRequestSchema,
  HistoryIdParamSchema,
  ModeIdParamSchema,
  NoArgsSchema,
  PaneParamSchema,
  PushCaptureAudioRequestSchema,
  PushCaptureLevelRequestSchema,
  ReportCaptureErrorRequestSchema,
  SaveAppSettingsRequestSchema,
  SaveDictionaryEntryRequestSchema,
  SaveModeRequestSchema,
  SaveProviderConfigRequestSchema,
  TestProviderRequestSchema,
} from "@soto/core";

interface CommandSpec {
  input: z.ZodTypeAny;
  allowedWindows: readonly WindowKind[];
}

const MAIN_ONLY: readonly WindowKind[] = ["main"];
const MAIN_AND_CAPSULE: readonly WindowKind[] = ["main", "capsule"];

// One entry per renderer→main command. `input` validates the payload.
export const COMMAND_POLICY = {
  health: { input: NoArgsSchema, allowedWindows: MAIN_ONLY },
  // Aggregated main-window app model (settings/modes/history/dictionary/provider
  // catalog+configs/permissions/mics + derived readiness) — the
  // single boot fact bundle every main-window page reads. The optional reason
  // lets the assembler scope a refresh (skip re-enumerating microphones).
  get_app_model: { input: GetAppModelRequestSchema, allowedWindows: MAIN_ONLY },
  get_app_settings: { input: NoArgsSchema, allowedWindows: MAIN_ONLY },
  save_app_settings: { input: SaveAppSettingsRequestSchema, allowedWindows: MAIN_ONLY },
  list_microphone_devices: { input: NoArgsSchema, allowedWindows: MAIN_ONLY },
  list_permission_statuses: { input: NoArgsSchema, allowedWindows: MAIN_ONLY },
  open_permission_settings: { input: PaneParamSchema, allowedWindows: MAIN_ONLY },
  request_permission_authorization: { input: PaneParamSchema, allowedWindows: MAIN_ONLY },
  is_accessibility_trusted: { input: NoArgsSchema, allowedWindows: MAIN_ONLY },
  request_accessibility_permission: { input: NoArgsSchema, allowedWindows: MAIN_ONLY },
  save_mode: { input: SaveModeRequestSchema, allowedWindows: MAIN_ONLY },
  create_mode: { input: CreateModeRequestSchema, allowedWindows: MAIN_ONLY },
  delete_mode: { input: ModeIdParamSchema, allowedWindows: MAIN_ONLY },
  delete_history_record: { input: HistoryIdParamSchema, allowedWindows: MAIN_ONLY },
  clear_history: { input: NoArgsSchema, allowedWindows: MAIN_ONLY },
  // Native OS confirmation dialog, gating irreversible main-window actions
  // (e.g. clear-all history). Main-only: only the main window prompts.
  confirm_dialog: { input: ConfirmDialogSchema, allowedWindows: MAIN_ONLY },
  save_dictionary_entry: { input: SaveDictionaryEntryRequestSchema, allowedWindows: MAIN_ONLY },
  delete_dictionary_entry: { input: EntryIdParamSchema, allowedWindows: MAIN_ONLY },
  cancel_active_voice_runtime: { input: NoArgsSchema, allowedWindows: MAIN_AND_CAPSULE },
  finish_active_voice_runtime: { input: NoArgsSchema, allowedWindows: MAIN_AND_CAPSULE },
  // Capture lifecycle (renderer mic -> main SessionController). The capsule
  // window owns the AudioWorklet capture graph, so these are capsule-reachable
  // (the main window may also drive them for testing/diagnostics). Same
  // least-privilege class as the dictation cancel/finish pair.
  capture_started: { input: CaptureStartedRequestSchema, allowedWindows: MAIN_AND_CAPSULE },
  push_capture_audio: { input: PushCaptureAudioRequestSchema, allowedWindows: MAIN_AND_CAPSULE },
  push_capture_level: { input: PushCaptureLevelRequestSchema, allowedWindows: MAIN_AND_CAPSULE },
  report_capture_error: { input: ReportCaptureErrorRequestSchema, allowedWindows: MAIN_AND_CAPSULE },
  // Creating a config is save_provider_config with config_id: null; reads come
  // from get_app_model (providerCatalog / providerConfigs) — no per-list commands.
  save_provider_config: { input: SaveProviderConfigRequestSchema, allowedWindows: MAIN_ONLY },
  test_provider_config: { input: TestProviderRequestSchema, allowedWindows: MAIN_ONLY },
  // Delete a provider config (main-only). Engine-slot settings that still point
  // at the deleted id are intentionally left dangling — resolvers treat them as
  // missing (missing_provider), no silent re-pointing (engine spec §7.1).
  delete_provider_config: { input: ConfigIdParamSchema, allowedWindows: MAIN_ONLY },
  // Clear the SotoDB and relaunch — recovery when the app cannot get past
  // get_app_model (corrupt soto.db / unreadable secrets). Main-only and
  // destructive: gated behind a native confirm in the renderer entry.
  repair_data: { input: NoArgsSchema, allowedWindows: MAIN_ONLY },
} as const satisfies Record<string, CommandSpec>;

export type CommandName = keyof typeof COMMAND_POLICY;

export const ALL_COMMANDS = Object.keys(COMMAND_POLICY) as CommandName[];

/** The least-privilege command set the capsule window may invoke. */
export const CAPSULE_COMMANDS = ALL_COMMANDS.filter((name) =>
  COMMAND_POLICY[name].allowedWindows.includes("capsule"),
);

export type CommandHandler = (
  input: unknown,
  ctx: SenderContext,
) => unknown | Promise<unknown>;

/**
 * Compose the command policy with main-process handlers into a router
 * registry. Throws if any command is missing a handler, so a forgotten wiring
 * fails loudly at startup rather than silently dropping a command.
 */
export function createIpcRegistry(
  handlers: Partial<Record<CommandName, CommandHandler>>,
): Record<CommandName, AnyCommandDefinition> {
  const registry = {} as Record<CommandName, AnyCommandDefinition>;
  for (const name of ALL_COMMANDS) {
    const handler = handlers[name];
    if (handler === undefined) {
      throw new Error(`missing IPC handler for command: ${name}`);
    }
    const spec = COMMAND_POLICY[name];
    registry[name] = {
      input: spec.input,
      allowedWindows: spec.allowedWindows,
      handler,
    } satisfies CommandDefinition;
  }
  return registry;
}
