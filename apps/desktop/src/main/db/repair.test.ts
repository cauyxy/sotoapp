import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deleteSotoDbFiles, repairData } from "./repair.js";

function makeDataDir(): string {
  return mkdtempSync(join(tmpdir(), "soto-repair-"));
}

describe("deleteSotoDbFiles", () => {
  it("removes soto.db and its wal/shm siblings, leaving other files", () => {
    const dir = makeDataDir();
    writeFileSync(join(dir, "soto.db"), "db");
    writeFileSync(join(dir, "soto.db-wal"), "wal");
    writeFileSync(join(dir, "soto.db-shm"), "shm");
    writeFileSync(join(dir, "keep.txt"), "keep");

    const removed = deleteSotoDbFiles(dir);

    expect(new Set(removed)).toEqual(new Set(["soto.db", "soto.db-wal", "soto.db-shm"]));
    expect(existsSync(join(dir, "soto.db"))).toBe(false);
    expect(existsSync(join(dir, "soto.db-wal"))).toBe(false);
    expect(existsSync(join(dir, "soto.db-shm"))).toBe(false);
    expect(existsSync(join(dir, "keep.txt"))).toBe(true);
  });

  it("is idempotent when the db files are absent (returns nothing removed)", () => {
    const dir = makeDataDir();
    expect(deleteSotoDbFiles(dir)).toEqual([]);
  });
});

describe("repairData", () => {
  it("closes the db, deletes the SotoDB, then relaunches and exits in order", () => {
    const dir = makeDataDir();
    writeFileSync(join(dir, "soto.db"), "db");
    const calls: string[] = [];

    repairData({
      dataDir: dir,
      closeDb: () => calls.push("close"),
      relaunch: () => calls.push("relaunch"),
      exit: () => calls.push("exit"),
    });

    expect(existsSync(join(dir, "soto.db"))).toBe(false);
    expect(calls).toEqual(["close", "relaunch", "exit"]);
  });

  it("still wipes and restarts when closeDb throws (a broken store must not block the wipe)", () => {
    const dir = makeDataDir();
    writeFileSync(join(dir, "soto.db"), "db");
    const calls: string[] = [];

    repairData({
      dataDir: dir,
      closeDb: () => {
        throw new Error("store already broken");
      },
      relaunch: () => calls.push("relaunch"),
      exit: () => calls.push("exit"),
    });

    expect(existsSync(join(dir, "soto.db"))).toBe(false);
    expect(calls).toEqual(["relaunch", "exit"]);
  });
});
