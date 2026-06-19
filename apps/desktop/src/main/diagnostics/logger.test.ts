import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createMainLogger,
  resolveMainLogConfig,
  type ConsoleLike,
} from "./logger.js";

function tempUserData() {
  const dir = mkdtempSync(join(tmpdir(), "soto-logger-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function silentConsole(): ConsoleLike {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe("resolveMainLogConfig", () => {
  it("defaults unpackaged builds to debug-depth dev logging", () => {
    expect(resolveMainLogConfig({ isPackaged: false, env: {} })).toMatchObject({
      profile: "dev",
      minLevel: "debug",
    });
  });

  it("defaults packaged builds to release logging unless explicitly marked as smoke", () => {
    expect(resolveMainLogConfig({ isPackaged: true, env: {} })).toMatchObject({
      profile: "release",
      minLevel: "info",
    });
    expect(
      resolveMainLogConfig({
        isPackaged: true,
        env: { SOTO_LOG_PROFILE: "smoke" },
      }),
    ).toMatchObject({
      profile: "smoke",
      minLevel: "debug",
    });
  });

  it("lets SOTO_LOG_LEVEL override the profile default depth", () => {
    expect(
      resolveMainLogConfig({
        isPackaged: false,
        env: { SOTO_LOG_LEVEL: "warn" },
      }),
    ).toMatchObject({
      profile: "dev",
      minLevel: "warn",
    });
  });
});

describe("createMainLogger", () => {
  it("writes debug lines to the file in smoke profile", () => {
    const { dir, cleanup } = tempUserData();
    try {
      const logger = createMainLogger({
        userDataPath: dir,
        isPackaged: true,
        env: { SOTO_LOG_PROFILE: "smoke" },
        now: () => new Date("2026-06-16T01:02:03.004Z"),
        console: silentConsole(),
      });

      logger.scope("injection").debug("focus_probe", {
        status: "no_focus",
        text_chars: 12,
      });

      expect(readFileSync(logger.filePath, "utf8")).toContain(
        "2026-06-16T01:02:03.004Z DEBUG injection focus_probe status=no_focus text_chars=12",
      );
    } finally {
      cleanup();
    }
  });

  it("filters debug lines out of release profile files", () => {
    const { dir, cleanup } = tempUserData();
    try {
      const logger = createMainLogger({
        userDataPath: dir,
        isPackaged: true,
        env: {},
        now: () => new Date("2026-06-16T01:02:03.004Z"),
        console: silentConsole(),
      });

      const startup = logger.scope("startup");
      startup.debug("hidden_debug");
      startup.info("ready", { profile: "release" });

      const contents = readFileSync(logger.filePath, "utf8");
      expect(contents).not.toContain("hidden_debug");
      expect(contents).toContain(
        "2026-06-16T01:02:03.004Z INFO startup ready profile=release",
      );
    } finally {
      cleanup();
    }
  });

  it("quotes field values with spaces without dropping the key", () => {
    const { dir, cleanup } = tempUserData();
    try {
      const logger = createMainLogger({
        userDataPath: dir,
        isPackaged: false,
        env: {},
        now: () => new Date("2026-06-16T01:02:03.004Z"),
        console: silentConsole(),
      });

      logger.scope("voice").info("session_start", {
        app_name: "Google Chrome",
        window_title_chars: 27,
      });

      expect(readFileSync(logger.filePath, "utf8")).toContain(
        'INFO voice session_start app_name="Google Chrome" window_title_chars=27',
      );
    } finally {
      cleanup();
    }
  });
});
