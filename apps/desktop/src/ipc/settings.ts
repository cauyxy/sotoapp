import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const SETTINGS_COMMANDS = {
  getAppSettings: "get_app_settings",
  listMicrophoneDevices: "list_microphone_devices",
  listPermissionStatuses: "list_permission_statuses",
  openPermissionSettings: "open_permission_settings",
  requestPermissionAuthorization: "request_permission_authorization",
  saveAppSettings: "save_app_settings"
} as const;

export const PERMISSION_UPDATED_EVENT = "permission://updated";

export interface AppSettings {
  locale: string;
  active_provider_config_id: string | null;
  transcription_language_hint: string;
  microphone_device_id: string | null;
  input_level: number;
  history_enabled: boolean;
  store_target_metadata: boolean;
  theme: string;
  use_proxy: boolean;
}

export interface MicrophoneDevice {
  id: string;
  name: string;
  is_default: boolean;
}

export interface MicrophoneSettingsDraft {
  microphone_device_id: string | null;
  input_level: number;
}

export interface PrivacySettingsDraft {
  history_enabled: boolean;
  store_target_metadata: boolean;
}

export interface LanguageSettingsDraft {
  locale: string;
  transcription_language_hint: string;
}

export type PermissionSettingsPane = "microphone" | "accessibility";
export type PermissionStatusKind =
  | "granted"
  | "needs_review"
  | "not_determined"
  | "denied"
  | "restricted"
  | "not_required"
  | "unknown";

export interface PermissionStatusRecord {
  pane: PermissionSettingsPane;
  kind: PermissionStatusKind;
  label: string;
  detail: string;
}

export interface PermissionStatusRow {
  pane: PermissionSettingsPane;
  kind: PermissionStatusKind;
  title: string;
  description: string;
  statusLabel: string;
  detail: string;
  tone: "ok" | "warn" | "idle";
  actionLabel: string;
  isSatisfied: boolean;
}

export function permissionSettingsRequest(pane: PermissionSettingsPane): { pane: PermissionSettingsPane } {
  return { pane };
}

export function permissionStatusRows(records: PermissionStatusRecord[]): PermissionStatusRow[] {
  const recordsByPane = new Map(records.map((record) => [record.pane, record]));

  return [
    permissionStatusRow(
      "microphone",
      "Microphone",
      "Required for recording audio while the hotkey is active.",
      microphoneActionLabel(recordsByPane.get("microphone")),
      recordsByPane.get("microphone")
    ),
    permissionStatusRow(
      "accessibility",
      "Accessibility",
      "Required for inserting final text into the current app and enabling global shortcuts on macOS.",
      "Open accessibility settings",
      recordsByPane.get("accessibility")
    )
  ];
}

export function permissionStatusesAreSatisfied(records: PermissionStatusRecord[]): boolean {
  return permissionStatusRows(records).every((row) => row.isSatisfied);
}

export function mergePermissionStatus(
  records: PermissionStatusRecord[],
  updated: PermissionStatusRecord
): PermissionStatusRecord[] {
  const existingIndex = records.findIndex((record) => record.pane === updated.pane);
  if (existingIndex === -1) return [...records, updated];

  const next = [...records];
  next[existingIndex] = updated;
  return next;
}

function permissionStatusRow(
  pane: PermissionSettingsPane,
  title: string,
  description: string,
  actionLabel: string,
  record: PermissionStatusRecord | undefined
): PermissionStatusRow {
  const normalized = record ?? {
    pane,
    kind: "unknown" as const,
    label: "Unknown",
    detail: "Soto could not read this permission state."
  };

  return {
    pane,
    kind: normalized.kind,
    title,
    description,
    statusLabel: normalized.label,
    detail: normalized.detail,
    tone: permissionStatusTone(normalized.kind),
    actionLabel,
    isSatisfied: normalized.kind === "granted" || normalized.kind === "not_required"
  };
}

function microphoneActionLabel(record: PermissionStatusRecord | undefined): string {
  if (record?.kind === "denied" || record?.kind === "restricted") return "Open microphone settings";
  return "Request microphone access";
}

function permissionStatusTone(kind: PermissionStatusKind): PermissionStatusRow["tone"] {
  if (kind === "granted" || kind === "not_required") return "ok";
  if (kind === "needs_review" || kind === "not_determined" || kind === "denied" || kind === "restricted") {
    return "warn";
  }
  return "idle";
}

export function createMicrophoneSettingsDraft(settings: AppSettings): MicrophoneSettingsDraft {
  return {
    microphone_device_id: settings.microphone_device_id,
    input_level: settings.input_level
  };
}

export function applyMicrophoneSettingsDraft(
  settings: AppSettings,
  draft: MicrophoneSettingsDraft
): AppSettings {
  return {
    ...settings,
    microphone_device_id: draft.microphone_device_id,
    input_level: draft.input_level
  };
}

export function createPrivacySettingsDraft(settings: AppSettings): PrivacySettingsDraft {
  return {
    history_enabled: settings.history_enabled,
    store_target_metadata: settings.store_target_metadata
  };
}

export function applyPrivacySettingsDraft(
  settings: AppSettings,
  draft: PrivacySettingsDraft
): AppSettings {
  return {
    ...settings,
    history_enabled: draft.history_enabled,
    store_target_metadata: draft.store_target_metadata
  };
}

export function createLanguageSettingsDraft(settings: AppSettings): LanguageSettingsDraft {
  return {
    locale: settings.locale,
    transcription_language_hint: settings.transcription_language_hint
  };
}

export function applyLanguageSettingsDraft(
  settings: AppSettings,
  draft: LanguageSettingsDraft
): AppSettings {
  return {
    ...settings,
    locale: draft.locale,
    transcription_language_hint: draft.transcription_language_hint
  };
}

export async function getAppSettings(): Promise<AppSettings> {
  return invoke(SETTINGS_COMMANDS.getAppSettings);
}

export async function listMicrophoneDevices(): Promise<MicrophoneDevice[]> {
  return invoke(SETTINGS_COMMANDS.listMicrophoneDevices);
}

export async function listPermissionStatuses(): Promise<PermissionStatusRecord[]> {
  return invoke(SETTINGS_COMMANDS.listPermissionStatuses);
}

export async function openPermissionSettings(pane: PermissionSettingsPane): Promise<void> {
  return invoke(SETTINGS_COMMANDS.openPermissionSettings, permissionSettingsRequest(pane));
}

export async function requestPermissionAuthorization(pane: PermissionSettingsPane): Promise<PermissionStatusRecord> {
  return invoke(SETTINGS_COMMANDS.requestPermissionAuthorization, permissionSettingsRequest(pane));
}

export function subscribePermissionUpdates(
  handler: (record: PermissionStatusRecord) => void
): Promise<UnlistenFn> {
  return listen<PermissionStatusRecord>(PERMISSION_UPDATED_EVENT, (event) => handler(event.payload));
}

export async function saveAppSettings(settings: AppSettings): Promise<AppSettings> {
  return invoke(SETTINGS_COMMANDS.saveAppSettings, { settings });
}
