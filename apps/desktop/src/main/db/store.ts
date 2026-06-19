// SqliteStore — the concrete persistence layer behind the 27 IPC handlers
// (plan §4). Wraps a better-sqlite3 connection and uses the pure @soto/core
// codec for every row <-> DTO crossing. The only IO-side concerns that live
// here (and are deliberately kept out of the codec) are:
//   - SQL statement shapes + ordering/limits the handlers need,
//   - app-enforced invariants the schema can't express (single default
//     provider config, built-in-mode delete no-op, term-UNIQUE upsert),
//   - encrypt-on-write / decrypt-on-read of provider secrets via a CryptoPort
//     (real impl = Electron safeStorage; tests = identity).
//
// Timestamps are unix-ms, generated with Date.now() and stored as INTEGER.
// All multi-statement mutations run inside better-sqlite3 transactions so a
// failed invariant rolls the whole change back.

import type BetterSqlite3 from "better-sqlite3";
import {
  canonicalModeRecords,
  dictionaryEntryRowToDto,
  dictionaryEntryToRow,
  historyRecordRowToDto,
  historyRecordToRow,
  modeRowToDto,
  modeToRow,
  providerConfigRowToDto,
  providerConfigToRow,
  AppSettingsSchema,
  DEFAULT_DICTATION_PROMPT,
  DEFAULT_DICTIONARY_TERMS,
  DEFAULT_TRANSLATE_PROMPT,
  PostInsertObservationSchema,
  type AppSettings,
  type DictionaryEntry,
  type DictionaryEntryRow,
  type HistoryRecord,
  type HistoryRecordRow,
  type Mode,
  type PostInsertObservation,
  type ModeRow,
  type ProviderConfig,
  type ProviderConfigRow,
} from "@soto/core";

const RECENT_HISTORY_LIMIT = 250;
const BUILTIN_MODE_REPAIR_FLAG = "builtin_modes_v3_complete";
const WINDOWS_DEFAULT_HOTKEY_REPAIR_FLAG = "windows_default_hotkey_v3";
const BUILTIN_MODE_PROMPT_REPAIR_FLAG = "builtin_mode_prompts_v1_complete";
const DEFAULT_DICTIONARY_SEED_FLAG = "default_dictionary_v1_complete";

// The built-in voice-mode set + their pinned field values (RightMeta default for
// macOS, translate, …) live in @soto/core's canonical catalog — the single
// source of truth shared with the renderer. This seed just stamps them with the
// seed clock; adding a built-in mode is a one-place edit in core. Windows gets
// a desktop-layer repair below because Meta is the OS key and Soto does not
// swallow global hotkeys.
function builtInModes(now: number): Mode[] {
  return canonicalModeRecords(now);
}

function defaultDictionaryRows(now: number): Array<{
  id: string;
  term: string;
  created_at: number;
}> {
  return DEFAULT_DICTIONARY_TERMS.map((entry, index) => ({
    id: entry.id,
    term: entry.term,
    created_at: now + index,
  }));
}

/**
 * Symmetric string cipher for provider secrets. The real adapter delegates to
 * Electron's `safeStorage`; tests pass an identity implementation. Ciphertext
 * is what lands in the `provider_secrets.api_key` TEXT column.
 */
export interface CryptoPort {
  encrypt(plain: string): string;
  decrypt(cipher: string): string;
}

/** Plaintext provider secrets — NEVER returned to the renderer. */
export interface ProviderSecrets {
  config_id: string;
  api_key: string;
  endpoint: string | null;
  updated_at: bigint;
}

interface ProviderSecretRow {
  config_id: string;
  api_key: string;
  endpoint: string | null;
  updated_at: number;
}

/** Fresh, empty `ProviderConfigValidation` for a newly-seeded/created config. */
function freshValidation(): ProviderConfig["validation"] {
  return {
    last_validated_at: null,
    last_validated_latency_ms: null,
    last_validated_status: "unspecified",
    last_validated_note: null,
    last_validated_sample: null,
    last_validated_sample_result: null,
  };
}

export class SqliteStore {
  constructor(
    private readonly db: BetterSqlite3.Database,
    private readonly crypto: CryptoPort,
  ) {}

  /**
   * Close the underlying connection. Releases the SQLite file lock (Windows
   * holds soto.db open) so data-repair can delete the db files. The store is
   * unusable afterwards — only called on the repair/relaunch path.
   */
  close(): void {
    this.db.close();
  }

  // --- first-seed ---------------------------------------------------------

  /**
   * Idempotently seed the built-in modes and mark `app_meta.initial_seed_complete`.
   * Also reconciles narrowly-scoped built-in defaults for existing databases that
   * were seeded before newer built-ins/defaults existed.
   */
  seedIfNeeded(): void {
    const seed = this.db.transaction(() => {
      const now = Date.now();
      const builtIns = builtInModes(now);
      const insert = this.db.prepare(
        `INSERT OR IGNORE INTO modes
           (id, name, prompt_body, hotkey_json, display_order, built_in, created_at, updated_at)
         VALUES (@id, @name, @prompt_body, @hotkey_json, @display_order, @built_in, @created_at, @updated_at)`,
      );

      const flag = this.db
        .prepare("SELECT value FROM app_meta WHERE key = ?")
        .get("initial_seed_complete") as { value: string } | undefined;
      for (const mode of builtIns) insert.run(modeToRow(mode));

      if (!flag) {
        this.db
          .prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)")
          .run("initial_seed_complete", "1");
      }

      const dictionarySeedFlag = this.db
        .prepare("SELECT value FROM app_meta WHERE key = ?")
        .get(DEFAULT_DICTIONARY_SEED_FLAG) as { value: string } | undefined;
      if (!dictionarySeedFlag) {
        const insertDefaultDictionary = this.db.prepare(
          `INSERT INTO dictionary_entries
             (id, term, source, hit_count, last_used_at, created_at)
           VALUES (@id, @term, 'user_added', 0, NULL, @created_at)
           ON CONFLICT(term) DO UPDATE SET
             source = 'user_added'
           WHERE dictionary_entries.source = 'auto_learned'`,
        );
        for (const row of defaultDictionaryRows(now)) {
          insertDefaultDictionary.run(row);
        }
        this.db
          .prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)")
          .run(DEFAULT_DICTIONARY_SEED_FLAG, "1");
      }

      const repairFlag = this.db
        .prepare("SELECT value FROM app_meta WHERE key = ?")
        .get(BUILTIN_MODE_REPAIR_FLAG) as { value: string } | undefined;
      if (!repairFlag) {
        this.db
          .prepare(
            `UPDATE modes
             SET hotkey_json = '{"chord":"RightMeta"}',
                 updated_at = ?
             WHERE id = 'default'
               AND name = 'Default'
               AND prompt_body = ''
               AND hotkey_json = '{"chord":"LeftMeta"}'
               AND built_in = 1`,
          )
          .run(now);
        this.db
          .prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)")
          .run(BUILTIN_MODE_REPAIR_FLAG, "1");
      }

      const windowsHotkeyRepairFlag = this.db
        .prepare("SELECT value FROM app_meta WHERE key = ?")
        .get(WINDOWS_DEFAULT_HOTKEY_REPAIR_FLAG) as { value: string } | undefined;
      if (process.platform === "win32" && !windowsHotkeyRepairFlag) {
        const rightCtrlTaken = this.db
          .prepare(
            `SELECT 1 FROM modes
             WHERE id <> 'default'
               AND hotkey_json LIKE '%"RightCtrl"%'
             LIMIT 1`,
          )
          .get() as { "1": number } | undefined;
        const replacement = rightCtrlTaken ? null : '{"chord":"RightCtrl"}';
        this.db
          .prepare(
            `UPDATE modes
             SET hotkey_json = ?,
                 updated_at = ?
             WHERE id = 'default'
               AND name = 'Default'
               AND prompt_body IN ('', ?)
               AND hotkey_json IN ('{"chord":"LeftMeta"}', '{"chord":"RightMeta"}', '{"chord":"RightShift"}', '{"chord":"RightAlt"}')
               AND built_in = 1`,
          )
          .run(replacement, now, DEFAULT_DICTATION_PROMPT);
        this.db
          .prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)")
          .run(WINDOWS_DEFAULT_HOTKEY_REPAIR_FLAG, "1");
      }

      const promptRepairFlag = this.db
        .prepare("SELECT value FROM app_meta WHERE key = ?")
        .get(BUILTIN_MODE_PROMPT_REPAIR_FLAG) as { value: string } | undefined;
      if (!promptRepairFlag) {
        this.db
          .prepare(
            `UPDATE modes
             SET prompt_body = ?,
                 updated_at = ?
             WHERE id = 'default'
               AND prompt_body = ''
               AND built_in = 1`,
          )
          .run(DEFAULT_DICTATION_PROMPT, now);
        this.db
          .prepare(
            `UPDATE modes
             SET prompt_body = ?,
                 updated_at = ?
             WHERE id = 'translate'
               AND prompt_body = ''
               AND built_in = 1`,
          )
          .run(DEFAULT_TRANSLATE_PROMPT, now);
        this.db
          .prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)")
          .run(BUILTIN_MODE_PROMPT_REPAIR_FLAG, "1");
      }
    });
    seed();
  }

  // --- modes --------------------------------------------------------------

  listModes(): Mode[] {
    const rows = this.db
      .prepare("SELECT * FROM modes ORDER BY display_order ASC, created_at ASC")
      .all() as ModeRow[];
    return rows.map(modeRowToDto);
  }

  getMode(id: string): Mode | null {
    const row = this.db
      .prepare("SELECT * FROM modes WHERE id = ?")
      .get(id) as ModeRow | undefined;
    return row ? modeRowToDto(row) : null;
  }

  /**
   * Upsert a mode. On update, `created_at` and `built_in` are preserved from
   * the existing row (a renderer cannot relabel a custom mode as built-in or
   * rewrite its creation time); `updated_at` is bumped to now.
   */
  saveMode(mode: Mode): Mode {
    const tx = this.db.transaction((m: Mode): Mode => {
      const existing = this.db
        .prepare("SELECT created_at, built_in FROM modes WHERE id = ?")
        .get(m.id) as
        | { created_at: number; built_in: number }
        | undefined;

      const merged: Mode = existing
        ? {
            ...m,
            created_at: BigInt(existing.created_at),
            built_in: existing.built_in !== 0,
            updated_at: BigInt(Date.now()),
          }
        : { ...m, updated_at: BigInt(Date.now()) };

      const row = modeToRow(merged);
      this.db
        .prepare(
          `INSERT INTO modes
             (id, name, prompt_body, hotkey_json, display_order, built_in, created_at, updated_at)
           VALUES (@id, @name, @prompt_body, @hotkey_json, @display_order, @built_in, @created_at, @updated_at)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             prompt_body = excluded.prompt_body,
             hotkey_json = excluded.hotkey_json,
             display_order = excluded.display_order,
             updated_at = excluded.updated_at`,
        )
        .run(row);
      return merged;
    });
    return tx(mode);
  }

  /**
   * Delete a mode. No-op for built-in modes — the `modes_no_delete_builtin`
   * trigger would otherwise ABORT, so we guard here to keep the call a silent
   * no-op rather than a thrown error.
   */
  deleteMode(id: string): void {
    const row = this.db
      .prepare("SELECT built_in FROM modes WHERE id = ?")
      .get(id) as { built_in: number } | undefined;
    if (!row || row.built_in !== 0) return;
    this.db.prepare("DELETE FROM modes WHERE id = ?").run(id);
  }

  // --- dictionary ---------------------------------------------------------

  // Matches Rust read_dictionary: insertion order (created_at ASC). Hotword
  // ranking (hit_count/recency) is computed separately by readActiveHotwords
  // in @soto/core, not baked into this list read.
  listDictionary(): DictionaryEntry[] {
    const rows = this.db
      .prepare("SELECT * FROM dictionary_entries ORDER BY created_at ASC")
      .all() as DictionaryEntryRow[];
    return rows.map(dictionaryEntryRowToDto);
  }

  getDictionaryEntry(id: string): DictionaryEntry | null {
    const row = this.db
      .prepare("SELECT * FROM dictionary_entries WHERE id = ?")
      .get(id) as DictionaryEntryRow | undefined;
    return row ? dictionaryEntryRowToDto(row) : null;
  }

  /** Upsert a dictionary entry by id. `term` is UNIQUE (enforced by schema). */
  saveDictionaryEntry(entry: DictionaryEntry): DictionaryEntry {
    const row = dictionaryEntryToRow(entry);
    this.db
      .prepare(
        `INSERT INTO dictionary_entries
           (id, term, source, hit_count, last_used_at, created_at)
         VALUES (@id, @term, @source, @hit_count, @last_used_at, @created_at)
         ON CONFLICT(id) DO UPDATE SET
           term = excluded.term,
           source = excluded.source,
           hit_count = excluded.hit_count,
           last_used_at = excluded.last_used_at`,
      )
      .run(row);
    return dictionaryEntryRowToDto(row);
  }

  deleteDictionaryEntry(id: string): void {
    this.db.prepare("DELETE FROM dictionary_entries WHERE id = ?").run(id);
  }

  // --- history ------------------------------------------------------------

  appendHistory(record: HistoryRecord): HistoryRecord {
    const row = historyRecordToRow(record);
    this.db
      .prepare(
        `INSERT INTO history_records (
           id, created_at, raw_text, processed_text, injected_text, edited_text,
           edited_text_status, edited_text_status_reason, mode_id, status, injection_outcome_json,
           speaking_duration_ms, char_count, target_app, target_app_name,
           target_window_title, target_control_type, ax_context_at_start_json,
           ax_context_at_end_json, audio_path, provider_id, model_id,
           llm_provider_id, llm_model_id, detected_language, mic_device_id
         ) VALUES (
           @id, @created_at, @raw_text, @processed_text, @injected_text, @edited_text,
           @edited_text_status, @edited_text_status_reason, @mode_id, @status, @injection_outcome_json,
           @speaking_duration_ms, @char_count, @target_app, @target_app_name,
           @target_window_title, @target_control_type, @ax_context_at_start_json,
           @ax_context_at_end_json, @audio_path, @provider_id, @model_id,
           @llm_provider_id, @llm_model_id, @detected_language, @mic_device_id
         )`,
      )
      .run(row);
    return historyRecordRowToDto(row);
  }

  async recordPostInsertObservation(
    historyId: string,
    observation: PostInsertObservation,
  ): Promise<boolean> {
    const parsed = PostInsertObservationSchema.parse(observation);
    const result = this.db
      .prepare(
        `UPDATE history_records
         SET edited_text = @edited_text,
             edited_text_status = @edited_text_status,
             edited_text_status_reason = @edited_text_status_reason,
             ax_context_at_end_json = @ax_context_at_end_json
         WHERE id = @history_id
           AND edited_text_status = 'pending'`,
      )
      .run({
        history_id: historyId,
        edited_text: parsed.edited_text,
        edited_text_status: parsed.edited_text_status,
        edited_text_status_reason: parsed.edited_text_status_reason,
        ax_context_at_end_json:
          parsed.ax_context_at_end === null
            ? null
            : JSON.stringify(parsed.ax_context_at_end),
      });
    return result.changes > 0;
  }

  sweepTimedOutPendingObservations(nowMs: number, timeoutMs: number): number {
    const cutoff = nowMs - timeoutMs;
    const result = this.db
      .prepare(
        `UPDATE history_records
         SET edited_text_status = 'unavailable',
             edited_text_status_reason = 'observer_timeout'
         WHERE edited_text_status = 'pending'
           AND created_at < ?`,
      )
      .run(cutoff);
    return result.changes;
  }

  /** All history, oldest first (created_at ASC). */
  listHistory(): HistoryRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM history_records ORDER BY created_at ASC")
      .all() as HistoryRecordRow[];
    return rows.map(historyRecordRowToDto);
  }

  /** The 250 newest records, newest first (created_at DESC). */
  listRecentHistory(): HistoryRecord[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM history_records ORDER BY created_at DESC, id DESC LIMIT ?",
      )
      .all(RECENT_HISTORY_LIMIT) as HistoryRecordRow[];
    return rows.map(historyRecordRowToDto);
  }

  deleteHistoryRecord(id: string): void {
    this.db.prepare("DELETE FROM history_records WHERE id = ?").run(id);
  }

  clearHistory(): void {
    this.db.prepare("DELETE FROM history_records").run();
  }

  // --- provider configs ---------------------------------------------------

  listProviderConfigs(): ProviderConfig[] {
    const rows = this.db
      .prepare("SELECT * FROM provider_configs ORDER BY created_at ASC")
      .all() as ProviderConfigRow[];
    return rows.map(providerConfigRowToDto);
  }

  getProviderConfig(configId: string): ProviderConfig | null {
    const row = this.db
      .prepare("SELECT * FROM provider_configs WHERE config_id = ?")
      .get(configId) as ProviderConfigRow | undefined;
    return row ? providerConfigRowToDto(row) : null;
  }

  /**
   * Upsert a provider config. If the incoming config is the default, every
   * other config is flipped to non-default first (single-default invariant).
   * `created_at` and `validation` are preserved on update.
   */
  upsertProviderConfig(config: ProviderConfig): ProviderConfig {
    const tx = this.db.transaction((c: ProviderConfig): ProviderConfig => {
      const existing = this.getProviderConfig(c.config_id);

      const merged: ProviderConfig = existing
        ? {
            ...c,
            created_at: existing.created_at,
            // Validation is owned by updateProviderValidation, not the config
            // editor — preserve the stored block across a plain config upsert.
            validation: existing.validation,
            updated_at: BigInt(Date.now()),
          }
        : { ...c, updated_at: BigInt(Date.now()) };

      if (merged.is_default) {
        this.db
          .prepare(
            "UPDATE provider_configs SET is_default = 0 WHERE config_id != ?",
          )
          .run(merged.config_id);
      }

      const row = providerConfigToRow(merged);
      this.db
        .prepare(
          `INSERT INTO provider_configs (
             config_id, provider_id, display_name, model, base_url,
             is_default, capability, validation_json, created_at, updated_at
           ) VALUES (
             @config_id, @provider_id, @display_name, @model, @base_url,
             @is_default, @capability, @validation_json, @created_at, @updated_at
           )
           ON CONFLICT(config_id) DO UPDATE SET
             provider_id = excluded.provider_id,
             display_name = excluded.display_name,
             model = excluded.model,
             base_url = excluded.base_url,
             is_default = excluded.is_default,
             capability = excluded.capability,
             updated_at = excluded.updated_at`,
        )
        .run(row);
      return merged;
    });
    return tx(config);
  }

  /** Replace the validation block for a config; bumps updated_at. */
  updateProviderValidation(
    configId: string,
    validation: ProviderConfig["validation"],
  ): ProviderConfig | null {
    const existing = this.getProviderConfig(configId);
    if (!existing) return null;
    const merged: ProviderConfig = {
      ...existing,
      validation,
      updated_at: BigInt(Date.now()),
    };
    const row = providerConfigToRow(merged);
    this.db
      .prepare(
        "UPDATE provider_configs SET validation_json = @validation_json, updated_at = @updated_at WHERE config_id = @config_id",
      )
      .run(row);
    return merged;
  }

  /** Delete a config; the FK cascade drops its provider_secrets row too. */
  deleteProviderConfig(configId: string): void {
    this.db
      .prepare("DELETE FROM provider_configs WHERE config_id = ?")
      .run(configId);
  }

  // --- provider secrets (never leave the main process) --------------------

  /** Read + decrypt a config's secrets, or null if none stored. */
  getProviderSecrets(configId: string): ProviderSecrets | null {
    const row = this.db
      .prepare("SELECT * FROM provider_secrets WHERE config_id = ?")
      .get(configId) as ProviderSecretRow | undefined;
    if (!row) return null;
    return {
      config_id: row.config_id,
      api_key: this.crypto.decrypt(row.api_key),
      endpoint: row.endpoint,
      updated_at: BigInt(row.updated_at),
    };
  }

  /** Encrypt + upsert a config's secrets. */
  putProviderSecrets(secrets: {
    config_id: string;
    api_key: string;
    endpoint: string | null;
  }): void {
    const row: ProviderSecretRow = {
      config_id: secrets.config_id,
      api_key: this.crypto.encrypt(secrets.api_key),
      endpoint: secrets.endpoint,
      updated_at: Date.now(),
    };
    this.db
      .prepare(
        `INSERT INTO provider_secrets (config_id, api_key, endpoint, updated_at)
         VALUES (@config_id, @api_key, @endpoint, @updated_at)
         ON CONFLICT(config_id) DO UPDATE SET
           api_key = excluded.api_key,
           endpoint = excluded.endpoint,
           updated_at = excluded.updated_at`,
      )
      .run(row);
  }

  deleteProviderSecrets(configId: string): void {
    this.db
      .prepare("DELETE FROM provider_secrets WHERE config_id = ?")
      .run(configId);
  }

  // --- app settings (stored as a JSON blob in app_meta) -------------------

  /** Read persisted app settings, or DEFAULT_APP_SETTINGS if none saved yet. */
  getSettings(): AppSettings {
    const row = this.db
      .prepare("SELECT value FROM app_meta WHERE key = ?")
      .get("app_settings") as { value: string } | undefined;
    if (!row) return { ...DEFAULT_APP_SETTINGS };
    return AppSettingsSchema.parse(JSON.parse(row.value));
  }

  saveSettings(settings: AppSettings): AppSettings {
    const validated = AppSettingsSchema.parse(settings);
    this.db
      .prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)")
      .run("app_settings", JSON.stringify(validated));
    return validated;
  }
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  locale: "zh",
  active_provider_config_id: null,
  engine_mode: "omni",
  active_asr_config_id: null,
  active_llm_config_id: null,
  transcription_language_hint: "",
  microphone_device_id: null,
  input_level: 0,
  history_enabled: true,
  include_window_context_in_requests: true,
  theme: "system",
  use_proxy: false,
  history_retention_days: 0,
  current_mode_id: null,
  audio_retention_enabled: false,
  hide_app_icon: false,
  launch_at_login: true,
  base_text_scale: "default",
};

/** Pass-through CryptoPort for tests / dev before safeStorage is wired. */
export const identityCrypto: CryptoPort = {
  encrypt: (plain) => plain,
  decrypt: (cipher) => cipher,
};

export { freshValidation };
