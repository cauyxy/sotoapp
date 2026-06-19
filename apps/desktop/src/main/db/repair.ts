// Data repair: clear the SotoDB and restart. Surfaced when the app cannot get
// past `get_app_model` (corrupt soto.db / unreadable safeStorage secrets) and
// the user has no other recovery than the dead-end "设置命令不可用" screen.
//
// Scope is deliberately narrow — only the SQLite DB and its WAL/SHM siblings are
// removed; the rest of the data dir (e.g. ~/.soto/native/*.dll) is preserved so
// repair never deletes the native runtime out from under the next launch. The
// store re-seeds defaults on the next open via seedIfNeeded().

import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

// soto.db plus the WAL/SHM that better-sqlite3 leaves alongside it. Deleting the
// db while a -wal still holds committed-but-uncheckpointed frames would let
// SQLite replay the bad state on next open, so all three must go together.
export const SOTO_DB_FILES = ["soto.db", "soto.db-wal", "soto.db-shm"] as const;

/**
 * Delete the SotoDB files from `dataDir`. Idempotent — a missing file is not an
 * error. Returns the basenames actually removed (for logging). A locked file
 * (Windows, db handle still open) throws, so callers must close the db first.
 */
export function deleteSotoDbFiles(dataDir: string): string[] {
  const removed: string[] = [];
  for (const name of SOTO_DB_FILES) {
    const path = join(dataDir, name);
    if (!existsSync(path)) continue;
    rmSync(path, { force: true });
    removed.push(name);
  }
  return removed;
}

export interface RepairDataDeps {
  /** Resolved Soto data dir (resolveDataDir()). */
  dataDir: string;
  /** Release the better-sqlite3 file lock before deletion (Windows holds it). */
  closeDb: () => void;
  /** app.relaunch() — queue a fresh instance to start after this one exits. */
  relaunch: () => void;
  /** app.exit(0) — terminate the current instance now. */
  exit: () => void;
  log?: (message: string) => void;
}

/**
 * Clear the SotoDB and restart. The db close is best-effort: a store that is
 * already broken (the reason we are here) must not block the wipe. Deletion
 * errors propagate so the caller can surface "repair failed" instead of
 * restarting into the same broken state.
 */
export function repairData(deps: RepairDataDeps): void {
  try {
    deps.closeDb();
  } catch (error) {
    deps.log?.(`repair_data: closeDb failed (continuing): ${String(error)}`);
  }
  const removed = deleteSotoDbFiles(deps.dataDir);
  deps.log?.(`repair_data: removed [${removed.join(", ")}]; relaunching`);
  deps.relaunch();
  deps.exit();
}
