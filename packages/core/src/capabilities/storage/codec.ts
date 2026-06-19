// Pure DTO <-> SQLite-row codec. Translates the zod-validated IPC DTOs into
// flat snake_case row objects (the shape the better-sqlite3 statements in
// apps/desktop bind/read) and back. Zero Electron/native/IO: just JSON
// serialization, bigint<->number and boolean<->0/1 mapping, plus zod
// validation on the read path so a malformed row throws rather than silently
// producing a bad DTO.
//
// Fidelity rules:
//  - nested objects (hotkey, injection_outcome, ax_context_*, validation)
//    serialize to `*_json` TEXT columns; a NULL DTO field becomes SQL NULL
//    (literal `null`, never the JSON string "null").
//  - bigint unix-ms timestamps map to INTEGER (number); read coerces back to
//    bigint via the schemas' z.coerce.bigint() timestamp type. NOTE: values
//    >= 2^53 lose precision through Number() — fine for ms timestamps and
//    recording durations (2^53 ms ≈ 285k years), not arbitrary bigints.
//  - booleans map to 0/1 INTEGER.
//  - snake_case enum strings pass through unchanged.

import {
  DictionaryEntrySchema,
  HistoryRecordSchema,
  ModeSchema,
  ProviderConfigSchema,
  type DictionaryEntry,
  type HistoryRecord,
  type Mode,
  type ProviderConfig,
} from "../../contract/schema.js";

// --- helpers --------------------------------------------------------------

const boolToInt = (value: boolean): number => (value ? 1 : 0);

/** Serialize a nullable nested object to a JSON TEXT column, preserving NULL. */
function jsonOrNull(value: unknown): string | null {
  return value === null ? null : JSON.stringify(value);
}

/** Parse a nullable JSON TEXT column back to a value (NULL stays null). */
function parseJsonOrNull(value: string | null): unknown {
  return value === null ? null : JSON.parse(value);
}

// --- Mode -----------------------------------------------------------------

export interface ModeRow {
  id: string;
  name: string;
  prompt_body: string;
  hotkey_json: string | null;
  display_order: number;
  built_in: number;
  created_at: number;
  updated_at: number;
}

export function modeToRow(dto: Mode): ModeRow {
  return {
    id: dto.id,
    name: dto.name,
    prompt_body: dto.prompt_body,
    hotkey_json: jsonOrNull(dto.hotkey),
    display_order: dto.display_order,
    built_in: boolToInt(dto.built_in),
    created_at: Number(dto.created_at),
    updated_at: Number(dto.updated_at),
  };
}

export function modeRowToDto(row: ModeRow): Mode {
  return ModeSchema.parse({
    id: row.id,
    name: row.name,
    prompt_body: row.prompt_body,
    hotkey: parseJsonOrNull(row.hotkey_json),
    display_order: row.display_order,
    built_in: row.built_in !== 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

// --- DictionaryEntry ------------------------------------------------------

export interface DictionaryEntryRow {
  id: string;
  term: string;
  source: string;
  hit_count: number;
  last_used_at: number | null;
  created_at: number;
}

export function dictionaryEntryToRow(dto: DictionaryEntry): DictionaryEntryRow {
  return {
    id: dto.id,
    term: dto.term,
    source: dto.source,
    hit_count: dto.hit_count,
    last_used_at: dto.last_used_at === null ? null : Number(dto.last_used_at),
    created_at: Number(dto.created_at),
  };
}

export function dictionaryEntryRowToDto(
  row: DictionaryEntryRow,
): DictionaryEntry {
  return DictionaryEntrySchema.parse({
    id: row.id,
    term: row.term,
    source: row.source,
    hit_count: row.hit_count,
    last_used_at: row.last_used_at,
    created_at: row.created_at,
  });
}

// --- HistoryRecord --------------------------------------------------------

export interface HistoryRecordRow {
  id: string;
  created_at: number;
  raw_text: string;
  processed_text: string | null;
  injected_text: string | null;
  edited_text: string | null;
  edited_text_status: string;
  edited_text_status_reason: string | null;
  mode_id: string | null;
  status: string;
  injection_outcome_json: string;
  speaking_duration_ms: number;
  char_count: number;
  target_app: string | null;
  target_app_name: string | null;
  target_window_title: string | null;
  target_control_type: string | null;
  ax_context_at_start_json: string | null;
  ax_context_at_end_json: string | null;
  audio_path: string | null;
  provider_id: string | null;
  model_id: string | null;
  llm_provider_id: string | null;
  llm_model_id: string | null;
  detected_language: string | null;
  mic_device_id: string | null;
}

export function historyRecordToRow(dto: HistoryRecord): HistoryRecordRow {
  return {
    id: dto.id,
    created_at: Number(dto.created_at),
    raw_text: dto.raw_text,
    processed_text: dto.processed_text,
    injected_text: dto.injected_text,
    edited_text: dto.edited_text,
    edited_text_status: dto.edited_text_status,
    edited_text_status_reason: dto.edited_text_status_reason,
    mode_id: dto.mode_id,
    status: dto.status,
    injection_outcome_json: JSON.stringify(dto.injection_outcome),
    speaking_duration_ms: Number(dto.speaking_duration_ms),
    char_count: dto.char_count,
    target_app: dto.target_app,
    target_app_name: dto.target_app_name,
    target_window_title: dto.target_window_title,
    target_control_type: dto.target_control_type,
    ax_context_at_start_json: jsonOrNull(dto.ax_context_at_start),
    ax_context_at_end_json: jsonOrNull(dto.ax_context_at_end),
    audio_path: dto.audio_path,
    provider_id: dto.provider_id,
    model_id: dto.model_id,
    llm_provider_id: dto.llm_provider_id,
    llm_model_id: dto.llm_model_id,
    detected_language: dto.detected_language,
    mic_device_id: dto.mic_device_id,
  };
}

export function historyRecordRowToDto(row: HistoryRecordRow): HistoryRecord {
  return HistoryRecordSchema.parse({
    id: row.id,
    created_at: row.created_at,
    raw_text: row.raw_text,
    processed_text: row.processed_text,
    injected_text: row.injected_text,
    edited_text: row.edited_text,
    edited_text_status: row.edited_text_status,
    edited_text_status_reason: row.edited_text_status_reason,
    mode_id: row.mode_id,
    status: row.status,
    injection_outcome: JSON.parse(row.injection_outcome_json),
    speaking_duration_ms: row.speaking_duration_ms,
    char_count: row.char_count,
    target_app: row.target_app,
    target_app_name: row.target_app_name,
    target_window_title: row.target_window_title,
    target_control_type: row.target_control_type,
    ax_context_at_start: parseJsonOrNull(row.ax_context_at_start_json),
    ax_context_at_end: parseJsonOrNull(row.ax_context_at_end_json),
    audio_path: row.audio_path,
    provider_id: row.provider_id,
    model_id: row.model_id,
    llm_provider_id: row.llm_provider_id,
    llm_model_id: row.llm_model_id,
    detected_language: row.detected_language,
    mic_device_id: row.mic_device_id,
  });
}

// --- ProviderConfig -------------------------------------------------------

export interface ProviderConfigRow {
  config_id: string;
  provider_id: string;
  display_name: string | null;
  model: string;
  base_url: string | null;
  is_default: number;
  capability: string;
  validation_json: string;
  created_at: number;
  updated_at: number;
}

export function providerConfigToRow(dto: ProviderConfig): ProviderConfigRow {
  // The validation block carries a nullable bigint timestamp; JSON.stringify
  // can't serialize bigint, so flatten it to a number for the JSON column.
  // The read path coerces it back to bigint via the schema's timestamp type.
  const validation = {
    ...dto.validation,
    last_validated_at:
      dto.validation.last_validated_at === null
        ? null
        : Number(dto.validation.last_validated_at),
  };
  return {
    config_id: dto.config_id,
    provider_id: dto.provider_id,
    display_name: dto.display_name,
    model: dto.model,
    base_url: dto.base_url,
    is_default: boolToInt(dto.is_default),
    capability: dto.capability,
    validation_json: JSON.stringify(validation),
    created_at: Number(dto.created_at),
    updated_at: Number(dto.updated_at),
  };
}

export function providerConfigRowToDto(row: ProviderConfigRow): ProviderConfig {
  if (row.is_default !== 0 && row.is_default !== 1) {
    throw new Error(`invalid is_default value: ${String(row.is_default)}`);
  }
  return ProviderConfigSchema.parse({
    config_id: row.config_id,
    provider_id: row.provider_id,
    display_name: row.display_name,
    model: row.model,
    base_url: row.base_url,
    is_default: row.is_default !== 0,
    capability: row.capability,
    validation: JSON.parse(row.validation_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}
