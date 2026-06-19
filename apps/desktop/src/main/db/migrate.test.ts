import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate.js";

function columns(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

function tableExists(db: Database.Database, table: string): boolean {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !==
    undefined
  );
}

describe("applyMigrations (fresh schema)", () => {
  it("creates all current columns on a fresh DB", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    expect(columns(db, "provider_configs")).toContain("capability");
    expect(columns(db, "history_records")).toContain("llm_provider_id");
    expect(columns(db, "history_records")).toContain("llm_model_id");
    expect(columns(db, "history_records")).toContain("edited_text_status_reason");
  });

  it("does not create removed tables/columns", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    expect(tableExists(db, "selection_actions")).toBe(false);
    expect(tableExists(db, "selection_action_settings")).toBe(false);
    expect(columns(db, "modes")).toEqual([
      "id",
      "name",
      "prompt_body",
      "hotkey_json",
      "display_order",
      "built_in",
      "created_at",
      "updated_at",
    ]);
  });

  it("is idempotent on repeat runs", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    expect(() => applyMigrations(db)).not.toThrow();
  });
});
