// Fresh-build migration for the Soto storage layer (plan §4: NO legacy
// migration — this only ever creates a brand-new schema). Idempotent: every
// statement uses IF NOT EXISTS, so re-running on an existing DB is a no-op.
//
// We run raw SQL via db.exec rather than drizzle-kit migrations to keep the
// IO side dependency-light and the on-disk DDL explicit and reviewable. The
// statements mirror apps/desktop/src/main/db/schema.ts exactly.

import type BetterSqlite3 from "better-sqlite3";

const SCHEMA_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS modes (
  id            TEXT    PRIMARY KEY,
  name          TEXT    NOT NULL,
  prompt_body   TEXT    NOT NULL,
  hotkey_json   TEXT,
  display_order INTEGER NOT NULL,
  built_in      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TRIGGER IF NOT EXISTS modes_no_delete_builtin
BEFORE DELETE ON modes
WHEN OLD.built_in = 1
BEGIN
  SELECT RAISE(ABORT, 'cannot delete a built-in mode');
END;

CREATE TABLE IF NOT EXISTS dictionary_entries (
  id           TEXT    PRIMARY KEY,
  term         TEXT    NOT NULL UNIQUE,
  source       TEXT    NOT NULL,
  hit_count    INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dict_source ON dictionary_entries (source);
CREATE INDEX IF NOT EXISTS idx_dict_ranking
  ON dictionary_entries (hit_count DESC, last_used_at DESC);

CREATE TABLE IF NOT EXISTS history_records (
  id                       TEXT    PRIMARY KEY,
  created_at               INTEGER NOT NULL,
  raw_text                 TEXT    NOT NULL,
  processed_text           TEXT,
  injected_text            TEXT,
  edited_text              TEXT,
  edited_text_status       TEXT    NOT NULL DEFAULT 'pending',
  edited_text_status_reason TEXT,
  mode_id                  TEXT,
  status                   TEXT    NOT NULL,
  injection_outcome_json   TEXT    NOT NULL,
  speaking_duration_ms     INTEGER NOT NULL,
  char_count               INTEGER NOT NULL,
  target_app               TEXT,
  target_app_name          TEXT,
  target_window_title      TEXT,
  target_control_type      TEXT,
  ax_context_at_start_json TEXT,
  ax_context_at_end_json   TEXT,
  audio_path               TEXT,
  provider_id              TEXT,
  model_id                 TEXT,
  llm_provider_id          TEXT,
  llm_model_id             TEXT,
  detected_language        TEXT,
  mic_device_id            TEXT
);

CREATE INDEX IF NOT EXISTS idx_history_created_at
  ON history_records (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_mode
  ON history_records (mode_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_target_app
  ON history_records (target_app, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_edit_status
  ON history_records (edited_text_status)
  WHERE edited_text_status = 'pending';

CREATE TABLE IF NOT EXISTS provider_configs (
  config_id       TEXT    PRIMARY KEY,
  provider_id     TEXT    NOT NULL,
  display_name    TEXT,
  model           TEXT    NOT NULL,
  base_url        TEXT,
  is_default      INTEGER NOT NULL DEFAULT 0,
  capability      TEXT    NOT NULL DEFAULT 'omni',
  validation_json TEXT    NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_secrets (
  config_id  TEXT    PRIMARY KEY
    REFERENCES provider_configs (config_id) ON DELETE CASCADE,
  api_key    TEXT    NOT NULL,
  endpoint   TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/**
 * Apply the full schema to a fresh (or already-migrated) database.
 *
 * Sets the connection PRAGMAs (WAL, NORMAL sync, foreign keys on) then creates
 * all tables, the built-in-mode delete guard trigger, and all indexes. Safe to
 * call on every startup — it is fully idempotent.
 */
export function applyMigrations(db: BetterSqlite3.Database): void {
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA_SQL);
}
