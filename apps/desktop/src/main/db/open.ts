import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";
import { applyMigrations } from "./migrate.js";
import { SqliteStore, type CryptoPort } from "./store.js";

// Resolve the Soto data directory: SOTO_DATA_DIR override (tests/dev) else
// ~/.soto (plan §4). The directory is created if absent.
export function resolveDataDir(): string {
  const override = process.env["SOTO_DATA_DIR"];
  const dir = override && override.length > 0 ? override : join(homedir(), ".soto");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Open ~/.soto/soto.db, run migrations + first-seed, return a ready store. */
export function openStore(crypto: CryptoPort): SqliteStore {
  const db = new Database(join(resolveDataDir(), "soto.db"));
  applyMigrations(db);
  const store = new SqliteStore(db, crypto);
  store.seedIfNeeded();
  return store;
}
