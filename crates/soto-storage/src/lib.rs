//! SQLite-backed persistence layer.
//!
//! Phase B replaced the JSONL-on-disk implementation with a single `soto.db`
//! file. The public `StorageRoot` type is kept as an alias for `SqliteStorage`
//! so existing call sites (tauri shell, voice runtime, etc.) keep working
//! without churn. Once those call sites switch to `Arc<dyn Trait>` via
//! `SessionDeps`, the alias can be dropped.

use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

use chrono::{DateTime, Utc};
use r2d2::{Pool, PooledConnection};
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{OptionalExtension, params};
use soto_core::{
    AppSettings, DictionaryEntry, DictionaryReader, DictionarySource, DictionaryStatus,
    HistoryRecord, HotkeyBinding, InjectionOutcome, Mode, ProviderConfig, ProviderConfigValidation,
    SessionStatus,
    stores::{
        DictionaryStore, HistoryStore, ModeStore, ProviderConfigStore, ProviderSecrets,
        ProviderSecretsStore, SettingsStore, StoreError,
    },
};
use soto_keyboard_hook::{Chord, Modifier};
use soto_prompt::{PromptDocument, PromptError, PromptStore, bundled_prompt_documents};
use thiserror::Error;

/// Schema version embedded in the binary. Bumping this in lockstep with a new
/// migration file lets the storage layer move existing databases forward.
const CURRENT_SCHEMA_VERSION: i64 = 1;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("storage io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("storage sql error: {0}")]
    Sql(#[from] rusqlite::Error),
    #[error("storage pool error: {0}")]
    Pool(String),
    #[error("storage json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("schema downgrade not supported: db={db_version}, code={code_version}")]
    SchemaDowngrade { db_version: i64, code_version: i64 },
    #[error("{0}")]
    Other(String),
}

impl From<r2d2::Error> for StorageError {
    fn from(value: r2d2::Error) -> Self {
        Self::Pool(value.to_string())
    }
}

pub type StorageResult<T> = Result<T, StorageError>;

#[derive(Clone)]
pub struct SqliteStorage {
    pool: Pool<SqliteConnectionManager>,
    db_path: PathBuf,
}

/// Back-compat alias — see module comment.
pub type StorageRoot = SqliteStorage;

/// Returns `~/.soto` on all platforms. Falls back to `$TEMP/.soto` if the
/// home directory cannot be determined.
fn home_soto_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    let home = std::env::var("USERPROFILE")
        .or_else(|_| {
            let drive = std::env::var("HOMEDRIVE")?;
            let path = std::env::var("HOMEPATH")?;
            Ok::<_, std::env::VarError>(format!("{drive}{path}"))
        })
        .map(PathBuf::from);
    #[cfg(not(target_os = "windows"))]
    let home = std::env::var("HOME").map(PathBuf::from);

    home.unwrap_or_else(|_| std::env::temp_dir()).join(".soto")
}

impl SqliteStorage {
    /// Resolve the storage path. `SOTO_DATA_DIR` overrides; otherwise
    /// `~/.soto` is used on all platforms. The directory is created if missing.
    /// The `fallback_dir` parameter is ignored and kept only for call-site
    /// backward compatibility — callers should switch to `open_home()`.
    pub fn open_default(_fallback_dir: &Path) -> StorageResult<Self> {
        Self::open_home()
    }

    /// Open (or create) the default `~/.soto/soto.db` database.
    /// `SOTO_DATA_DIR` overrides the directory when set.
    pub fn open_home() -> StorageResult<Self> {
        let dir = match std::env::var("SOTO_DATA_DIR") {
            Ok(value) if !value.trim().is_empty() => PathBuf::from(value),
            _ => home_soto_dir(),
        };
        std::fs::create_dir_all(&dir)?;
        Self::open(dir.join("soto.db"))
    }

    /// Open or create a SQLite database at `path`.
    pub fn open(path: impl AsRef<Path>) -> StorageResult<Self> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let manager = SqliteConnectionManager::file(&path).with_init(|conn| {
            conn.pragma_update(None, "journal_mode", "WAL")?;
            conn.pragma_update(None, "synchronous", "NORMAL")?;
            conn.pragma_update(None, "foreign_keys", "ON")?;
            Ok(())
        });
        let pool = Pool::builder()
            .max_size(8)
            .build(manager)
            .map_err(|err| StorageError::Pool(err.to_string()))?;

        let storage = Self {
            pool,
            db_path: path,
        };
        storage.init_schema_and_seed()?;
        Ok(storage)
    }

    /// Legacy `StorageRoot::new` shape. Treat the input as a directory and
    /// open `<dir>/soto.db` under it (so existing tests and Tauri shells that
    /// hand in an app data dir keep working).
    pub fn new(root: impl AsRef<Path>) -> Self {
        Self::open(root.as_ref().join("soto.db")).expect(
            "SqliteStorage::new failed — caller should switch to open_default for explicit errors",
        )
    }

    /// Path of the SQLite database file (used by health command).
    pub fn root(&self) -> &Path {
        &self.db_path
    }

    pub fn db_path(&self) -> &Path {
        &self.db_path
    }

    fn conn(&self) -> StorageResult<PooledConnection<SqliteConnectionManager>> {
        Ok(self.pool.get()?)
    }

    pub fn default_settings(&self) -> AppSettings {
        AppSettings {
            locale: "system".into(),
            active_provider_config_id: None,
            transcription_language_hint: "auto".into(),
            microphone_device_id: None,
            input_level: 100,
            history_enabled: true,
            store_target_metadata: true,
            theme: "system".to_string(),
            use_proxy: true,
        }
    }

    /// No-op for SQLite (schema + seed run inside `open`). Kept so existing
    /// callers that still invoke `.ensure()` keep compiling.
    pub fn ensure(&self) -> StorageResult<()> {
        Ok(())
    }

    fn init_schema_and_seed(&self) -> StorageResult<()> {
        let mut conn = self.conn()?;
        let tx = conn.transaction()?;
        tx.execute_batch(SCHEMA_SQL)?;

        // Resolve current schema version, then run forward migrations.
        let existing: Option<String> = tx
            .query_row(
                "SELECT value FROM app_meta WHERE key = 'schema_version'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        let db_version: i64 = match existing.as_deref() {
            Some(s) => s.parse().unwrap_or(0),
            None => 0,
        };

        if db_version > CURRENT_SCHEMA_VERSION {
            return Err(StorageError::SchemaDowngrade {
                db_version,
                code_version: CURRENT_SCHEMA_VERSION,
            });
        }

        // First-run seed: bundled prompts + built-in modes + default settings.
        let seeded: Option<String> = tx
            .query_row(
                "SELECT value FROM app_meta WHERE key = 'initial_seed_complete'",
                [],
                |row| row.get(0),
            )
            .optional()?;

        if seeded.as_deref() != Some("true") {
            let now = utc_now_str();
            // Bundled prompts.
            for doc in bundled_prompt_documents() {
                tx.execute(
                    "INSERT OR REPLACE INTO prompts (id, body, built_in, created_at, updated_at) \
                     VALUES (?, ?, 1, ?, ?)",
                    params![doc.id, doc.body, now, now],
                )?;
            }
            // Built-in modes.
            for mode in builtin_modes_seed() {
                insert_mode_in_tx(&tx, &mode, &now)?;
            }
            // Default settings.
            for (key, value) in default_settings_kv(&self.default_settings())? {
                tx.execute(
                    "INSERT OR REPLACE INTO settings (key, value_json) VALUES (?, ?)",
                    params![key, value],
                )?;
            }
            // Preset hotwords — shown to the user in first run; source = auto_learned so
            // the UI treats them like any other learned word (editable / deletable).
            let preset_hotwords: &[&str] = &[
                "TypeLess",
                "Type4Me",
                "Soto",
                "Made by Xinyu",
                "Claude Code",
                "Codex",
                "Vibe Coding",
                "Qwen3.5 Omni",
                "Doubao Seed2.0",
                "Xiaomi MiMo2.5",
            ];
            for (i, term) in preset_hotwords.iter().enumerate() {
                tx.execute(
                    "INSERT OR IGNORE INTO dictionary_entries \
                     (id, term, aliases_json, note, source, status, enabled, \
                      created_at, updated_at, last_used_at, hit_count) \
                     VALUES (?1, ?2, '[]', '', 'auto_learned', 'active', 1, ?3, ?3, NULL, 0)",
                    params![format!("preset-dict-{i}"), term, now],
                )?;
            }
            tx.execute(
                "INSERT OR REPLACE INTO app_meta (key, value) VALUES ('initial_seed_complete', 'true')",
                [],
            )?;
        }

        tx.execute(
            "INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', ?)",
            params![CURRENT_SCHEMA_VERSION.to_string()],
        )?;
        tx.commit()?;
        Ok(())
    }

    // ---------------- Modes ----------------

    pub fn read_modes(&self) -> StorageResult<Vec<Mode>> {
        let conn = self.conn()?;
        select_modes(&conn)
    }

    pub fn write_modes(&self, modes: &[Mode]) -> StorageResult<()> {
        let mut conn = self.conn()?;
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM modes WHERE built_in = 0", [])?;
        let now = utc_now_str();
        for mode in modes {
            insert_mode_in_tx(&tx, mode, &now)?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn seed_builtin_modes(&self) -> StorageResult<Vec<Mode>> {
        // The first-run seed already inserted built-ins. Just return the
        // current state, ordered by display_order.
        self.read_modes()
    }

    pub fn upsert_mode(&self, mode: &Mode) -> StorageResult<()> {
        let conn = self.conn()?;
        let now = utc_now_str();
        insert_mode(&conn, mode, &now)
    }

    pub fn delete_mode(&self, id: &str) -> StorageResult<()> {
        let conn = self.conn()?;
        conn.execute(
            "DELETE FROM modes WHERE id = ? AND built_in = 0",
            params![id],
        )?;
        Ok(())
    }

    // ---------------- Prompts ----------------

    pub fn read_prompt(&self, id: &str) -> StorageResult<PromptDocument> {
        let conn = self.conn()?;
        let row = conn
            .query_row(
                "SELECT id, body FROM prompts WHERE id = ?",
                params![id],
                |r| {
                    Ok(PromptDocument {
                        id: r.get(0)?,
                        body: r.get(1)?,
                    })
                },
            )
            .optional()?;
        row.ok_or_else(|| StorageError::Other(format!("prompt not found: {id}")))
    }

    pub fn write_prompt(&self, doc: &PromptDocument) -> StorageResult<()> {
        let conn = self.conn()?;
        let now = utc_now_str();
        // Preserve built_in flag if the row exists; otherwise default to 0.
        let built_in: i64 = conn
            .query_row(
                "SELECT built_in FROM prompts WHERE id = ?",
                params![doc.id],
                |r| r.get(0),
            )
            .optional()?
            .unwrap_or(0);
        conn.execute(
            "INSERT INTO prompts (id, body, built_in, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?) \
             ON CONFLICT(id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at",
            params![doc.id, doc.body, built_in, now, now],
        )?;
        Ok(())
    }

    pub fn delete_prompt(&self, id: &str) -> StorageResult<()> {
        let conn = self.conn()?;
        // Trigger enforces no-delete-built-in but we surface a clear error first.
        let n = conn.execute(
            "DELETE FROM prompts WHERE id = ? AND built_in = 0",
            params![id],
        )?;
        if n == 0 {
            return Err(StorageError::Other(format!(
                "prompt cannot be deleted (built-in or missing): {id}"
            )));
        }
        Ok(())
    }

    // ---------------- Settings ----------------

    pub fn read_settings(&self) -> StorageResult<AppSettings> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare("SELECT key, value_json FROM settings")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        let mut map = BTreeMap::new();
        for row in rows {
            let (k, v) = row?;
            map.insert(k, v);
        }
        Ok(settings_from_map(&map, &self.default_settings()))
    }

    pub fn write_settings(&self, settings: &AppSettings) -> StorageResult<()> {
        let mut conn = self.conn()?;
        let tx = conn.transaction()?;
        for (k, v) in settings_to_map(settings)? {
            tx.execute(
                "INSERT OR REPLACE INTO settings (key, value_json) VALUES (?, ?)",
                params![k, v],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    // ---------------- History ----------------

    pub fn append_history(&self, record: &HistoryRecord) -> StorageResult<()> {
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO history_records (id, created_at, raw_text, processing_mode, processed_text, \
             final_text, status, injection_outcome_json, speaking_duration_ms, char_count, \
             target_app, target_window_title, target_control_type, provider_id, model_id) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                record.id,
                record.created_at.to_rfc3339(),
                record.raw_text,
                record.processing_mode,
                record.processed_text,
                record.final_text,
                session_status_str(&record.status),
                serde_json::to_string(&record.injection_outcome)?,
                record.speaking_duration_ms as i64,
                record.char_count as i64,
                record.target_app,
                record.target_window_title,
                record.target_control_type,
                record.provider_id,
                record.model_id,
            ],
        )?;
        Ok(())
    }

    pub fn read_history(&self) -> StorageResult<Vec<HistoryRecord>> {
        self.history_query(None)
    }

    pub fn read_recent_history(&self, limit: usize) -> StorageResult<Vec<HistoryRecord>> {
        if limit == 0 {
            return Ok(Vec::new());
        }
        self.history_query(Some(limit))
    }

    pub fn delete_history_record(&self, history_id: &str) -> StorageResult<()> {
        let conn = self.conn()?;
        conn.execute(
            "DELETE FROM history_records WHERE id = ?",
            params![history_id],
        )?;
        Ok(())
    }

    pub fn clear_history(&self) -> StorageResult<()> {
        let conn = self.conn()?;
        conn.execute("DELETE FROM history_records", [])?;
        Ok(())
    }

    fn history_query(&self, limit: Option<usize>) -> StorageResult<Vec<HistoryRecord>> {
        let conn = self.conn()?;
        let sql_owned;
        let sql: &str = match limit {
            None => {
                "SELECT id, created_at, raw_text, processing_mode, processed_text, \
                     final_text, status, injection_outcome_json, speaking_duration_ms, \
                     char_count, target_app, target_window_title, target_control_type, \
                     provider_id, model_id FROM history_records ORDER BY created_at ASC"
            }
            Some(n) => {
                sql_owned = format!(
                    "SELECT id, created_at, raw_text, processing_mode, processed_text, \
                     final_text, status, injection_outcome_json, speaking_duration_ms, \
                     char_count, target_app, target_window_title, target_control_type, \
                     provider_id, model_id FROM history_records ORDER BY created_at DESC \
                     LIMIT {n}"
                );
                sql_owned.as_str()
            }
        };
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt.query_map([], history_row_to_record)?;
        let mut records: Vec<HistoryRecord> = rows.collect::<Result<_, _>>()?;
        // For `read_recent_history` we asked for DESC + LIMIT; flip to chronological.
        if limit.is_some() {
            records.reverse();
        }
        Ok(records)
    }

    // ---------------- Provider configs ----------------

    pub fn read_provider_configs(&self) -> StorageResult<Vec<ProviderConfig>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT config_id, provider_id, display_name, model, base_url, is_default, \
             validation_json, created_at, updated_at FROM provider_configs ORDER BY created_at",
        )?;
        let rows = stmt.query_map([], provider_config_row_to_record)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn write_provider_configs(&self, configs: &[ProviderConfig]) -> StorageResult<()> {
        let mut conn = self.conn()?;
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM provider_configs", [])?;
        for cfg in configs {
            insert_provider_config_in_tx(&tx, cfg)?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn upsert_provider_config(&self, record: ProviderConfig) -> StorageResult<()> {
        let mut conn = self.conn()?;
        let tx = conn.transaction()?;
        if record.is_default {
            tx.execute("UPDATE provider_configs SET is_default = 0", [])?;
        }
        insert_provider_config_in_tx(&tx, &record)?;
        tx.commit()?;
        Ok(())
    }

    pub fn update_provider_validation(
        &self,
        config_id: &str,
        validation: ProviderConfigValidation,
    ) -> StorageResult<()> {
        let conn = self.conn()?;
        let validation_json = serde_json::to_string(&validation)?;
        let now = utc_now_str();
        let n = conn.execute(
            "UPDATE provider_configs SET validation_json = ?, updated_at = ? WHERE config_id = ?",
            params![validation_json, now, config_id],
        )?;
        if n == 0 {
            return Err(StorageError::Other(format!(
                "provider config not found: {config_id}"
            )));
        }
        Ok(())
    }

    // ---------------- Provider secrets ----------------

    pub fn upsert_provider_secret(
        &self,
        config_id: &str,
        key: &str,
        value: &str,
    ) -> StorageResult<()> {
        let conn = self.conn()?;
        let now = utc_now_str();
        // Ensure the config row exists first (FK constraint).
        let exists: bool = conn
            .query_row(
                "SELECT 1 FROM provider_configs WHERE config_id = ?",
                params![config_id],
                |_| Ok(true),
            )
            .optional()?
            .unwrap_or(false);
        if !exists {
            return Err(StorageError::Other(format!(
                "provider config not found for secret upsert: {config_id}"
            )));
        }
        // Load existing secrets row, merge, write back.
        let mut current = self.read_provider_secrets_map(config_id)?;
        current.insert(key.to_string(), value.to_string());
        let api_key = current.get("api_key").cloned().unwrap_or_default();
        let endpoint = current.get("endpoint").cloned();
        conn.execute(
            "INSERT INTO provider_secrets (config_id, api_key, endpoint, updated_at) \
             VALUES (?, ?, ?, ?) \
             ON CONFLICT(config_id) DO UPDATE SET \
               api_key = excluded.api_key, \
               endpoint = excluded.endpoint, \
               updated_at = excluded.updated_at",
            params![config_id, api_key, endpoint, now],
        )?;
        Ok(())
    }

    /// Legacy shape: returns key-value map for the secret row.
    pub fn read_provider_secrets(
        &self,
        config_id: &str,
    ) -> StorageResult<BTreeMap<String, String>> {
        self.read_provider_secrets_map(config_id)
    }

    fn read_provider_secrets_map(
        &self,
        config_id: &str,
    ) -> StorageResult<BTreeMap<String, String>> {
        let conn = self.conn()?;
        let row = conn
            .query_row(
                "SELECT api_key, endpoint FROM provider_secrets WHERE config_id = ?",
                params![config_id],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)),
            )
            .optional()?;
        let mut map = BTreeMap::new();
        if let Some((api_key, endpoint)) = row {
            if !api_key.is_empty() {
                map.insert("api_key".to_string(), api_key);
            }
            if let Some(ep) = endpoint {
                map.insert("endpoint".to_string(), ep);
            }
        }
        Ok(map)
    }

    // ---------------- Dictionary ----------------

    pub fn write_dictionary(&self, entries: &[DictionaryEntry]) -> StorageResult<()> {
        let mut conn = self.conn()?;
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM dictionary_entries", [])?;
        for entry in entries {
            insert_dictionary_in_tx(&tx, entry)?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn read_dictionary(&self) -> StorageResult<Vec<DictionaryEntry>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, term, aliases_json, note, source, status, enabled, \
             created_at, updated_at, last_used_at, hit_count FROM dictionary_entries \
             ORDER BY created_at",
        )?;
        let rows = stmt.query_map([], dictionary_row_to_entry)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn upsert_dictionary_entry(&self, entry: DictionaryEntry) -> StorageResult<()> {
        let conn = self.conn()?;
        insert_dictionary(&conn, &entry)
    }

    pub fn delete_dictionary_entry(&self, id: &str) -> StorageResult<()> {
        let conn = self.conn()?;
        conn.execute("DELETE FROM dictionary_entries WHERE id = ?", params![id])?;
        Ok(())
    }
}

// ===== Free helpers =====

fn utc_now_str() -> String {
    Utc::now().to_rfc3339()
}

fn session_status_str(s: &SessionStatus) -> &'static str {
    match s {
        SessionStatus::Completed => "completed",
        SessionStatus::Empty => "empty",
        SessionStatus::Failed => "failed",
        SessionStatus::Cancelled => "cancelled",
    }
}

fn parse_session_status(s: &str) -> SessionStatus {
    match s {
        "empty" => SessionStatus::Empty,
        "failed" => SessionStatus::Failed,
        "cancelled" => SessionStatus::Cancelled,
        _ => SessionStatus::Completed,
    }
}

fn select_modes(conn: &rusqlite::Connection) -> StorageResult<Vec<Mode>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, hotkey_json, display_order, built_in, prompt_id \
         FROM modes ORDER BY display_order",
    )?;
    let rows = stmt.query_map([], |r| {
        let id: String = r.get(0)?;
        let name: String = r.get(1)?;
        let hotkey_json: Option<String> = r.get(2)?;
        let display_order: i64 = r.get(3)?;
        let built_in: i64 = r.get(4)?;
        let prompt_id: String = r.get(5)?;
        let hotkey: Option<HotkeyBinding> = hotkey_json
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok());
        Ok(Mode {
            id,
            name,
            hotkey,
            display_order: display_order as u32,
            built_in: built_in != 0,
            prompt_id,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn insert_mode(conn: &rusqlite::Connection, mode: &Mode, now: &str) -> StorageResult<()> {
    let hotkey_json = mode
        .hotkey
        .as_ref()
        .map(serde_json::to_string)
        .transpose()?;
    conn.execute(
        "INSERT INTO modes (id, name, hotkey_json, display_order, built_in, prompt_id, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) \
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, hotkey_json = excluded.hotkey_json, \
           display_order = excluded.display_order, prompt_id = excluded.prompt_id, \
           updated_at = excluded.updated_at",
        params![
            mode.id,
            mode.name,
            hotkey_json,
            mode.display_order as i64,
            mode.built_in as i64,
            mode.prompt_id,
            now,
            now,
        ],
    )?;
    Ok(())
}

fn insert_mode_in_tx(tx: &rusqlite::Transaction, mode: &Mode, now: &str) -> StorageResult<()> {
    let hotkey_json = mode
        .hotkey
        .as_ref()
        .map(serde_json::to_string)
        .transpose()?;
    tx.execute(
        "INSERT INTO modes (id, name, hotkey_json, display_order, built_in, prompt_id, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) \
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, hotkey_json = excluded.hotkey_json, \
           display_order = excluded.display_order, prompt_id = excluded.prompt_id, \
           updated_at = excluded.updated_at",
        params![
            mode.id,
            mode.name,
            hotkey_json,
            mode.display_order as i64,
            mode.built_in as i64,
            mode.prompt_id,
            now,
            now,
        ],
    )?;
    Ok(())
}

fn insert_provider_config_in_tx(
    tx: &rusqlite::Transaction,
    cfg: &ProviderConfig,
) -> StorageResult<()> {
    let validation_json = serde_json::to_string(&cfg.validation)?;
    tx.execute(
        "INSERT INTO provider_configs (config_id, provider_id, display_name, model, base_url, \
         is_default, validation_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) \
         ON CONFLICT(config_id) DO UPDATE SET provider_id = excluded.provider_id, \
           display_name = excluded.display_name, model = excluded.model, \
           base_url = excluded.base_url, is_default = excluded.is_default, \
           validation_json = excluded.validation_json, updated_at = excluded.updated_at",
        params![
            cfg.config_id,
            cfg.provider_id,
            cfg.display_name,
            cfg.model,
            cfg.base_url,
            cfg.is_default as i64,
            validation_json,
            cfg.created_at.to_rfc3339(),
            cfg.updated_at.to_rfc3339(),
        ],
    )?;
    Ok(())
}

fn provider_config_row_to_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProviderConfig> {
    let config_id: String = row.get(0)?;
    let provider_id: String = row.get(1)?;
    let display_name: Option<String> = row.get(2)?;
    let model: String = row.get(3)?;
    let base_url: Option<String> = row.get(4)?;
    let is_default: i64 = row.get(5)?;
    let validation_json: String = row.get(6)?;
    let created_at: String = row.get(7)?;
    let updated_at: String = row.get(8)?;
    let validation: ProviderConfigValidation =
        serde_json::from_str(&validation_json).unwrap_or(ProviderConfigValidation {
            last_validated_at: None,
            last_validated_latency_ms: None,
            last_validated_status: soto_core::ValidationStatus::Unspecified,
            last_validated_note: None,
            last_validated_sample: None,
            last_validated_sample_result: None,
        });
    Ok(ProviderConfig {
        config_id,
        provider_id,
        display_name,
        model,
        base_url,
        is_default: is_default != 0,
        validation,
        created_at: parse_dt_or_now(&created_at),
        updated_at: parse_dt_or_now(&updated_at),
    })
}

fn parse_dt_or_now(s: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}

fn dictionary_row_to_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<DictionaryEntry> {
    let id: String = row.get(0)?;
    let term: String = row.get(1)?;
    let aliases_json: String = row.get(2)?;
    let note: String = row.get(3)?;
    let source: String = row.get(4)?;
    let status: String = row.get(5)?;
    let enabled: i64 = row.get(6)?;
    let created_at: String = row.get(7)?;
    let updated_at: String = row.get(8)?;
    let last_used_at: Option<String> = row.get(9)?;
    let hit_count: i64 = row.get(10)?;
    let aliases: Vec<String> = serde_json::from_str(&aliases_json).unwrap_or_default();
    Ok(DictionaryEntry {
        id,
        term,
        aliases,
        note,
        source: match source.as_str() {
            "auto_learned" => DictionarySource::AutoLearned,
            _ => DictionarySource::UserAdded,
        },
        status: match status.as_str() {
            "suggested" => DictionaryStatus::Suggested,
            "archived" => DictionaryStatus::Archived,
            _ => DictionaryStatus::Active,
        },
        enabled: enabled != 0,
        created_at: parse_dt_or_now(&created_at),
        updated_at: parse_dt_or_now(&updated_at),
        last_used_at: last_used_at.as_deref().map(parse_dt_or_now),
        hit_count: hit_count as u32,
    })
}

fn insert_dictionary(conn: &rusqlite::Connection, entry: &DictionaryEntry) -> StorageResult<()> {
    let aliases_json = serde_json::to_string(&entry.aliases)?;
    let source = match entry.source {
        DictionarySource::UserAdded => "user_added",
        DictionarySource::AutoLearned => "auto_learned",
    };
    let status = match entry.status {
        DictionaryStatus::Active => "active",
        DictionaryStatus::Suggested => "suggested",
        DictionaryStatus::Archived => "archived",
    };
    let now = utc_now_str();
    conn.execute(
        "INSERT INTO dictionary_entries (id, term, aliases_json, note, source, status, enabled, \
         created_at, updated_at, last_used_at, hit_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
         ON CONFLICT(id) DO UPDATE SET term = excluded.term, aliases_json = excluded.aliases_json, \
           note = excluded.note, source = excluded.source, status = excluded.status, \
           enabled = excluded.enabled, updated_at = excluded.updated_at, \
           last_used_at = excluded.last_used_at, hit_count = excluded.hit_count",
        params![
            entry.id,
            entry.term,
            aliases_json,
            entry.note,
            source,
            status,
            entry.enabled as i64,
            entry.created_at.to_rfc3339(),
            now,
            entry.last_used_at.map(|d| d.to_rfc3339()),
            entry.hit_count as i64,
        ],
    )?;
    Ok(())
}

fn insert_dictionary_in_tx(
    tx: &rusqlite::Transaction,
    entry: &DictionaryEntry,
) -> StorageResult<()> {
    let aliases_json = serde_json::to_string(&entry.aliases)?;
    let source = match entry.source {
        DictionarySource::UserAdded => "user_added",
        DictionarySource::AutoLearned => "auto_learned",
    };
    let status = match entry.status {
        DictionaryStatus::Active => "active",
        DictionaryStatus::Suggested => "suggested",
        DictionaryStatus::Archived => "archived",
    };
    let now = utc_now_str();
    tx.execute(
        "INSERT INTO dictionary_entries (id, term, aliases_json, note, source, status, enabled, \
         created_at, updated_at, last_used_at, hit_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
         ON CONFLICT(id) DO UPDATE SET term = excluded.term, aliases_json = excluded.aliases_json, \
           note = excluded.note, source = excluded.source, status = excluded.status, \
           enabled = excluded.enabled, updated_at = excluded.updated_at, \
           last_used_at = excluded.last_used_at, hit_count = excluded.hit_count",
        params![
            entry.id,
            entry.term,
            aliases_json,
            entry.note,
            source,
            status,
            entry.enabled as i64,
            entry.created_at.to_rfc3339(),
            now,
            entry.last_used_at.map(|d| d.to_rfc3339()),
            entry.hit_count as i64,
        ],
    )?;
    Ok(())
}

fn history_row_to_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<HistoryRecord> {
    let id: String = row.get(0)?;
    let created_at: String = row.get(1)?;
    let raw_text: String = row.get(2)?;
    let processing_mode: String = row.get(3)?;
    let processed_text: Option<String> = row.get(4)?;
    let final_text: String = row.get(5)?;
    let status: String = row.get(6)?;
    let injection_outcome_json: String = row.get(7)?;
    let speaking_duration_ms: i64 = row.get(8)?;
    let char_count: i64 = row.get(9)?;
    let target_app: String = row.get(10)?;
    let target_window_title: String = row.get(11)?;
    let target_control_type: String = row.get(12)?;
    let provider_id: Option<String> = row.get(13)?;
    let model_id: Option<String> = row.get(14)?;
    let injection_outcome: InjectionOutcome =
        serde_json::from_str(&injection_outcome_json).unwrap_or(InjectionOutcome::NoOp);
    Ok(HistoryRecord {
        id,
        created_at: parse_dt_or_now(&created_at),
        raw_text,
        processing_mode,
        processed_text,
        final_text,
        status: parse_session_status(&status),
        injection_outcome,
        speaking_duration_ms: speaking_duration_ms as u64,
        char_count: char_count as u32,
        target_app,
        target_window_title,
        target_control_type,
        provider_id,
        model_id,
    })
}

// ===== Settings (de)serialisation =====

fn settings_to_map(s: &AppSettings) -> StorageResult<Vec<(&'static str, String)>> {
    Ok(vec![
        ("locale", serde_json::to_string(&s.locale)?),
        (
            "active_provider_config_id",
            serde_json::to_string(&s.active_provider_config_id)?,
        ),
        (
            "transcription_language_hint",
            serde_json::to_string(&s.transcription_language_hint)?,
        ),
        (
            "microphone_device_id",
            serde_json::to_string(&s.microphone_device_id)?,
        ),
        ("input_level", serde_json::to_string(&s.input_level)?),
        (
            "history_enabled",
            serde_json::to_string(&s.history_enabled)?,
        ),
        (
            "store_target_metadata",
            serde_json::to_string(&s.store_target_metadata)?,
        ),
        ("theme", serde_json::to_string(&s.theme)?),
    ])
}

fn settings_from_map(map: &BTreeMap<String, String>, defaults: &AppSettings) -> AppSettings {
    fn parse<T: serde::de::DeserializeOwned>(
        map: &BTreeMap<String, String>,
        key: &str,
        fallback: T,
    ) -> T {
        map.get(key)
            .and_then(|v| serde_json::from_str(v).ok())
            .unwrap_or(fallback)
    }
    AppSettings {
        locale: parse(map, "locale", defaults.locale.clone()),
        active_provider_config_id: parse(
            map,
            "active_provider_config_id",
            defaults.active_provider_config_id.clone(),
        ),
        transcription_language_hint: parse(
            map,
            "transcription_language_hint",
            defaults.transcription_language_hint.clone(),
        ),
        microphone_device_id: parse(
            map,
            "microphone_device_id",
            defaults.microphone_device_id.clone(),
        ),
        input_level: parse(map, "input_level", defaults.input_level),
        history_enabled: parse(map, "history_enabled", defaults.history_enabled),
        store_target_metadata: parse(map, "store_target_metadata", defaults.store_target_metadata),
        theme: parse(map, "theme", defaults.theme.clone()),
        use_proxy: parse(map, "use_proxy", defaults.use_proxy),
    }
}

fn default_settings_kv(defaults: &AppSettings) -> StorageResult<Vec<(&'static str, String)>> {
    settings_to_map(defaults)
}

// ===== Built-in mode seed =====

fn builtin_modes_seed() -> Vec<Mode> {
    vec![default_seed(), translate_seed()]
}

fn default_seed() -> Mode {
    Mode {
        id: "default".into(),
        name: "Default".into(),
        hotkey: Some(hold_binding(platform_default_modifier())),
        display_order: 1,
        built_in: true,
        prompt_id: "default".into(),
    }
}

fn translate_seed() -> Mode {
    Mode {
        id: "translate".into(),
        name: "Translate".into(),
        hotkey: Some(hold_binding(Modifier::RightShift)),
        display_order: 2,
        built_in: true,
        prompt_id: "translate".into(),
    }
}

fn platform_default_modifier() -> Modifier {
    if cfg!(target_os = "macos") {
        Modifier::RightMeta
    } else {
        Modifier::RightCtrl
    }
}

fn hold_binding(modifier: Modifier) -> HotkeyBinding {
    HotkeyBinding {
        chord: Chord::new(modifier),
        style: soto_core::HotkeyStyle::Hold,
    }
}

// ===== Schema =====

const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompts (
  id         TEXT PRIMARY KEY,
  body       TEXT NOT NULL,
  built_in   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS prompts_no_delete_builtin
BEFORE DELETE ON prompts WHEN OLD.built_in = 1
BEGIN SELECT RAISE(ABORT, 'built-in prompt cannot be deleted'); END;

CREATE TABLE IF NOT EXISTS modes (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  hotkey_json   TEXT,
  display_order INTEGER NOT NULL,
  built_in      INTEGER NOT NULL DEFAULT 0,
  prompt_id     TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  FOREIGN KEY(prompt_id) REFERENCES prompts(id) ON DELETE RESTRICT
);

CREATE TRIGGER IF NOT EXISTS modes_no_delete_builtin
BEFORE DELETE ON modes WHEN OLD.built_in = 1
BEGIN SELECT RAISE(ABORT, 'built-in mode cannot be deleted'); END;

CREATE TABLE IF NOT EXISTS dictionary_entries (
  id            TEXT PRIMARY KEY,
  term          TEXT NOT NULL,
  aliases_json  TEXT NOT NULL,
  note          TEXT NOT NULL,
  source        TEXT NOT NULL,
  status        TEXT NOT NULL,
  enabled       INTEGER NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  last_used_at  TEXT,
  hit_count     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS provider_configs (
  config_id        TEXT PRIMARY KEY,
  provider_id      TEXT NOT NULL,
  display_name     TEXT,
  model            TEXT NOT NULL,
  base_url         TEXT,
  is_default       INTEGER NOT NULL DEFAULT 0,
  validation_json  TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_secrets (
  config_id  TEXT PRIMARY KEY,
  api_key    TEXT NOT NULL,
  endpoint   TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(config_id) REFERENCES provider_configs(config_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS history_records (
  id                     TEXT PRIMARY KEY,
  created_at             TEXT NOT NULL,
  raw_text               TEXT NOT NULL,
  processing_mode        TEXT NOT NULL,
  processed_text         TEXT,
  final_text             TEXT NOT NULL,
  status                 TEXT NOT NULL,
  injection_outcome_json TEXT NOT NULL,
  speaking_duration_ms   INTEGER NOT NULL,
  char_count             INTEGER NOT NULL,
  target_app             TEXT NOT NULL,
  target_window_title    TEXT NOT NULL,
  target_control_type    TEXT NOT NULL,
  provider_id            TEXT,
  model_id               TEXT
);

CREATE INDEX IF NOT EXISTS idx_history_created_at ON history_records(created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
"#;

// ===== DictionaryReader compat =====

impl DictionaryReader for SqliteStorage {
    fn read_dictionary(&self) -> Result<Vec<DictionaryEntry>, String> {
        SqliteStorage::read_dictionary(self).map_err(|err| err.to_string())
    }
}

// ===== Store trait impls =====

fn store_err(err: StorageError) -> StoreError {
    StoreError::Storage(err.to_string())
}

impl PromptStore for SqliteStorage {
    fn get(&self, id: &str) -> Result<PromptDocument, PromptError> {
        SqliteStorage::read_prompt(self, id).map_err(|err| PromptError::Storage(err.to_string()))
    }

    fn put(&self, doc: &PromptDocument) -> Result<(), PromptError> {
        SqliteStorage::write_prompt(self, doc).map_err(|err| PromptError::Storage(err.to_string()))
    }

    fn delete(&self, id: &str) -> Result<(), PromptError> {
        SqliteStorage::delete_prompt(self, id).map_err(|err| PromptError::Storage(err.to_string()))
    }
}

impl ModeStore for SqliteStorage {
    fn list(&self) -> Result<Vec<Mode>, StoreError> {
        SqliteStorage::read_modes(self).map_err(store_err)
    }

    fn get(&self, id: &str) -> Result<Mode, StoreError> {
        ModeStore::list(self)?
            .into_iter()
            .find(|m| m.id == id)
            .ok_or_else(|| StoreError::NotFound(id.to_owned()))
    }

    fn put(&self, mode: &Mode) -> Result<(), StoreError> {
        SqliteStorage::upsert_mode(self, mode).map_err(store_err)
    }

    fn delete(&self, id: &str) -> Result<(), StoreError> {
        let modes = ModeStore::list(self)?;
        if modes.iter().any(|m| m.id == id && m.built_in) {
            return Err(StoreError::Storage(format!(
                "built-in mode cannot be deleted: {id}"
            )));
        }
        SqliteStorage::delete_mode(self, id).map_err(store_err)
    }
}

impl DictionaryStore for SqliteStorage {
    fn list(&self) -> Result<Vec<DictionaryEntry>, StoreError> {
        SqliteStorage::read_dictionary(self).map_err(store_err)
    }

    fn put(&self, entry: &DictionaryEntry) -> Result<(), StoreError> {
        SqliteStorage::upsert_dictionary_entry(self, entry.clone()).map_err(store_err)
    }

    fn delete(&self, id: &str) -> Result<(), StoreError> {
        SqliteStorage::delete_dictionary_entry(self, id).map_err(store_err)
    }
}

impl ProviderConfigStore for SqliteStorage {
    fn list(&self) -> Result<Vec<ProviderConfig>, StoreError> {
        SqliteStorage::read_provider_configs(self).map_err(store_err)
    }

    fn get(&self, config_id: &str) -> Result<ProviderConfig, StoreError> {
        ProviderConfigStore::list(self)?
            .into_iter()
            .find(|c| c.config_id == config_id)
            .ok_or_else(|| StoreError::NotFound(config_id.to_owned()))
    }

    fn put(&self, config: &ProviderConfig) -> Result<(), StoreError> {
        SqliteStorage::upsert_provider_config(self, config.clone()).map_err(store_err)
    }

    fn delete(&self, config_id: &str) -> Result<(), StoreError> {
        let conn = self.conn().map_err(store_err)?;
        conn.execute(
            "DELETE FROM provider_configs WHERE config_id = ?",
            params![config_id],
        )
        .map_err(|err| StoreError::Storage(err.to_string()))?;
        Ok(())
    }

    fn set_default(&self, config_id: &str) -> Result<(), StoreError> {
        let mut conn = self.conn().map_err(store_err)?;
        let tx = conn
            .transaction()
            .map_err(|err| StoreError::Storage(err.to_string()))?;
        let exists: bool = tx
            .query_row(
                "SELECT 1 FROM provider_configs WHERE config_id = ?",
                params![config_id],
                |_| Ok(true),
            )
            .optional()
            .map_err(|err| StoreError::Storage(err.to_string()))?
            .unwrap_or(false);
        if !exists {
            return Err(StoreError::NotFound(config_id.to_owned()));
        }
        tx.execute("UPDATE provider_configs SET is_default = 0", [])
            .map_err(|err| StoreError::Storage(err.to_string()))?;
        tx.execute(
            "UPDATE provider_configs SET is_default = 1 WHERE config_id = ?",
            params![config_id],
        )
        .map_err(|err| StoreError::Storage(err.to_string()))?;
        tx.commit()
            .map_err(|err| StoreError::Storage(err.to_string()))?;
        Ok(())
    }
}

impl ProviderSecretsStore for SqliteStorage {
    fn get(&self, config_id: &str) -> Result<ProviderSecrets, StoreError> {
        let mut bag = SqliteStorage::read_provider_secrets(self, config_id).map_err(store_err)?;
        let api_key = bag.remove("api_key").unwrap_or_default();
        let endpoint = bag.remove("endpoint");
        Ok(ProviderSecrets { api_key, endpoint })
    }

    fn put(&self, config_id: &str, secrets: &ProviderSecrets) -> Result<(), StoreError> {
        SqliteStorage::upsert_provider_secret(self, config_id, "api_key", &secrets.api_key)
            .map_err(store_err)?;
        if let Some(endpoint) = &secrets.endpoint {
            SqliteStorage::upsert_provider_secret(self, config_id, "endpoint", endpoint)
                .map_err(store_err)?;
        }
        Ok(())
    }

    fn delete(&self, config_id: &str) -> Result<(), StoreError> {
        let conn = self.conn().map_err(store_err)?;
        conn.execute(
            "DELETE FROM provider_secrets WHERE config_id = ?",
            params![config_id],
        )
        .map_err(|err| StoreError::Storage(err.to_string()))?;
        Ok(())
    }
}

impl HistoryStore for SqliteStorage {
    fn append(&self, record: &HistoryRecord) -> Result<(), StoreError> {
        SqliteStorage::append_history(self, record).map_err(store_err)
    }

    fn list_recent(&self, limit: usize) -> Result<Vec<HistoryRecord>, StoreError> {
        SqliteStorage::read_recent_history(self, limit).map_err(store_err)
    }

    fn delete(&self, id: &str) -> Result<(), StoreError> {
        SqliteStorage::delete_history_record(self, id).map_err(store_err)
    }

    fn clear(&self) -> Result<(), StoreError> {
        SqliteStorage::clear_history(self).map_err(store_err)
    }
}

impl SettingsStore for SqliteStorage {
    fn read(&self) -> Result<AppSettings, StoreError> {
        SqliteStorage::read_settings(self).map_err(store_err)
    }

    fn write(&self, settings: &AppSettings) -> Result<(), StoreError> {
        SqliteStorage::write_settings(self, settings).map_err(store_err)
    }
}

/// Convenience for tests: build a freshly-seeded storage rooted at `dir`. Uses
/// `tempfile::TempDir` so r2d2 pool can share the data across connections.
pub fn open_temp_storage(dir: &Path) -> StorageResult<SqliteStorage> {
    SqliteStorage::open(dir.join("soto.db"))
}
