// Drizzle ORM schema for the Soto storage layer (IO/native side).
//
// This is the on-disk shape at ~/.soto/soto.db. It is deliberately *flatter*
// and lower-level than the @soto/core DTOs (packages/core/src/contract/schema.ts):
//   - DTO nested objects (mode.hotkey, history.injection_outcome,
//     history.ax_context_at_start/end, providerConfig.validation) are stored
//     here as `*_json` TEXT columns and (de)serialized at the store boundary.
//   - DTO bigint timestamps are INTEGER (unix-ms) here.
//   - DTO booleans are 0/1 INTEGER here.
// The store layer is responsible for the row <-> DTO mapping; this module only
// describes columns.

import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

// --- modes ----------------------------------------------------------------

export const modes = sqliteTable("modes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  promptBody: text("prompt_body").notNull(),
  // JSON of HotkeyBinding { chord } or null.
  hotkeyJson: text("hotkey_json"),
  displayOrder: integer("display_order").notNull(),
  // 0/1 boolean.
  builtIn: integer("built_in").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// --- dictionary_entries ---------------------------------------------------

export const dictionaryEntries = sqliteTable(
  "dictionary_entries",
  {
    id: text("id").primaryKey(),
    term: text("term").notNull().unique(),
    // 'user_added' | 'auto_learned'
    source: text("source").notNull(),
    hitCount: integer("hit_count").notNull().default(0),
    lastUsedAt: integer("last_used_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    idxDictSource: index("idx_dict_source").on(table.source),
    idxDictRanking: index("idx_dict_ranking").on(
      sql`${table.hitCount} DESC`,
      sql`${table.lastUsedAt} DESC`,
    ),
  }),
);

// --- history_records ------------------------------------------------------

export const historyRecords = sqliteTable(
  "history_records",
  {
    id: text("id").primaryKey(),
    createdAt: integer("created_at").notNull(),
    rawText: text("raw_text").notNull(),
    processedText: text("processed_text"),
    injectedText: text("injected_text"),
    editedText: text("edited_text"),
    // 'pending' | 'captured' | 'failed' | 'unavailable' | 'not_observed'
    editedTextStatus: text("edited_text_status").notNull().default("pending"),
    editedTextStatusReason: text("edited_text_status_reason"),
    modeId: text("mode_id"),
    // 'completed' | 'empty' | 'failed' | 'cancelled'
    status: text("status").notNull(),
    // InjectionOutcome tagged union (on `kind`) as JSON.
    injectionOutcomeJson: text("injection_outcome_json").notNull(),
    speakingDurationMs: integer("speaking_duration_ms").notNull(),
    charCount: integer("char_count").notNull(),
    targetApp: text("target_app"),
    targetAppName: text("target_app_name"),
    targetWindowTitle: text("target_window_title"),
    targetControlType: text("target_control_type"),
    // AxContext as JSON.
    axContextAtStartJson: text("ax_context_at_start_json"),
    axContextAtEndJson: text("ax_context_at_end_json"),
    audioPath: text("audio_path"),
    providerId: text("provider_id"),
    modelId: text("model_id"),
    detectedLanguage: text("detected_language"),
    micDeviceId: text("mic_device_id"),
  },
  (table) => ({
    idxHistoryCreatedAt: index("idx_history_created_at").on(
      sql`${table.createdAt} DESC`,
    ),
    idxHistoryMode: index("idx_history_mode").on(
      table.modeId,
      sql`${table.createdAt} DESC`,
    ),
    idxHistoryTargetApp: index("idx_history_target_app").on(
      table.targetApp,
      sql`${table.createdAt} DESC`,
    ),
    // Partial index for the edit-capture work queue.
    idxHistoryEditStatus: index("idx_history_edit_status")
      .on(table.editedTextStatus)
      .where(sql`${table.editedTextStatus} = 'pending'`),
  }),
);

// --- provider_configs -----------------------------------------------------

export const providerConfigs = sqliteTable("provider_configs", {
  configId: text("config_id").primaryKey(),
  providerId: text("provider_id").notNull(),
  displayName: text("display_name"),
  model: text("model").notNull(),
  baseUrl: text("base_url"),
  // 0/1 boolean; single default is app-enforced.
  isDefault: integer("is_default").notNull(),
  // ProviderConfigValidation as JSON.
  validationJson: text("validation_json").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// --- provider_secrets -----------------------------------------------------
// NEVER returned to the renderer.

export const providerSecrets = sqliteTable("provider_secrets", {
  configId: text("config_id")
    .primaryKey()
    .references(() => providerConfigs.configId, { onDelete: "cascade" }),
  // Ciphertext (safeStorage-encrypted).
  apiKey: text("api_key").notNull(),
  endpoint: text("endpoint"),
  updatedAt: integer("updated_at").notNull(),
});

// --- app_meta -------------------------------------------------------------
// Generic KV (e.g. the 'initial_seed_complete' flag).

export const appMeta = sqliteTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
