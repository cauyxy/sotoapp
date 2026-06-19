import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  installAndLaunchWindows,
  main as windowsPackageMain,
  missingPackagedRuntimeDependencies,
  parseCliArgs,
  windowsAbiSymbols,
} from "./verify-windows-native-package.mjs";

test("desktop package preserves workspace name and declares packaged productName", () => {
  const pkg = JSON.parse(readFileSync(resolve("apps/desktop/package.json"), "utf8"));

  assert.equal(pkg.name, "@soto/desktop");
  assert.equal(pkg.productName, "Soto");
});

function windowsExtraResourceSources(configText) {
  const lines = configText.split(/\r?\n/);
  const winIndex = lines.findIndex((line) => line.trim() === "win:");
  if (winIndex === -1) return [];

  const sources = [];
  for (const line of lines.slice(winIndex + 1)) {
    if (/^\S/.test(line)) break;
    const match = line.match(/^\s+- from:\s*(.+?)\s*$/);
    if (match) sources.push(match[1]);
  }
  return sources;
}

function topLevelSectionBody(configText, sectionName) {
  const lines = configText.split(/\r?\n/);
  const sectionIndex = lines.findIndex((line) => line.trim() === `${sectionName}:`);
  if (sectionIndex === -1) return "";

  const body = [];
  for (const line of lines.slice(sectionIndex + 1)) {
    if (/^\S/.test(line)) break;
    body.push(line);
  }
  return body.join("\n");
}

test("Windows packaging stages the NativeAOT publish DLL", () => {
  const config = readFileSync(
    resolve("apps/desktop/electron-builder.yml"),
    "utf8",
  );
  const sources = windowsExtraResourceSources(config);

  assert.ok(
    sources.includes("../../native/windows/bin/Release/net8.0/win-x64/publish"),
    "Windows extraResources must copy the NativeAOT publish output",
  );
  assert.ok(
    !sources.includes("../../native/windows/bin/Release/net8.0/win-x64"),
    "Windows extraResources must not copy the intermediate managed DLL",
  );
});

test("Windows installer uses assisted Soto install flow", () => {
  const config = readFileSync(resolve("apps/desktop/electron-builder.yml"), "utf8");
  const nsis = topLevelSectionBody(config, "nsis");

  assert.match(nsis, /^  oneClick: false$/m);
  assert.match(nsis, /^  allowToChangeInstallationDirectory: true$/m);
  assert.match(nsis, /^  shortcutName: Soto$/m);
});

test("Windows package smoke requires the queued hook drain export consumed by the native bridge", () => {
  const symbols = windowsAbiSymbols(resolve("packages/native-bridge/src/koffiAbi.ts"));

  assert.ok(symbols.includes("soto_win_hook_next_event"));
});

function writer() {
  let text = "";
  return {
    stream: {
      write(chunk) {
        text += chunk;
      },
    },
    text() {
      return text;
    },
  };
}

function sink() {
  return { write() {} };
}

function createWinUnpackedFixture(appDirPath = "apps/desktop/dist/win-unpacked") {
  const repoRoot = mkdtempSync(join(tmpdir(), "soto-win-reload-"));
  const appDir = join(repoRoot, appDirPath);
  mkdirSync(appDir, { recursive: true });
  writeFileSync(join(appDir, "Soto.exe"), "exe");
  return { repoRoot, appDir, cleanup: () => rmSync(repoRoot, { recursive: true, force: true }) };
}

test("Windows package smoke parses --reload", () => {
  assert.deepEqual(parseCliArgs(["--verify-only", "--reload"]), {
    help: false,
    verifyOnly: true,
    reload: true,
  });
  assert.equal(parseCliArgs([]).reload, false);
});

test("installAndLaunchWindows stops Soto, copies win-unpacked, then launches with smoke logging", () => {
  const fixture = createWinUnpackedFixture();
  const calls = [];
  const installDir = resolve(fixture.repoRoot, "installed/Soto");

  try {
    const installed = installAndLaunchWindows({
      repoRoot: fixture.repoRoot,
      installDir,
      runCommand(command, args, options) {
        calls.push({ command, args, stdio: options?.stdio, encoding: options?.encoding });
        if (command === "robocopy") return { status: 1, stdout: "copied", stderr: "" };
        return { status: 0, stdout: "", stderr: "" };
      },
      stdout: sink(),
    });

    assert.equal(installed, resolve(installDir, "Soto.exe"));
    assert.deepEqual(calls.map((call) => call.command), ["taskkill", "robocopy", "powershell.exe"]);
    assert.deepEqual(calls[0].args, ["/IM", "Soto.exe", "/F", "/T"]);
    assert.deepEqual(calls[1].args, [fixture.appDir, installDir, "/E"]);
    assert.match(calls[2].args.at(-1), /SOTO_LOG_PROFILE/);
    assert.match(calls[2].args.at(-1), /Start-Process/);
    assert.match(calls[2].args.at(-1), /Soto\.exe/);
  } finally {
    fixture.cleanup();
  }
});

test("installAndLaunchWindows defaults reload install directory to Soto", () => {
  const fixture = createWinUnpackedFixture();
  const calls = [];
  const originalLocalAppData = process.env.LOCALAPPDATA;
  const originalUserProfile = process.env.USERPROFILE;
  const localAppData = resolve(fixture.repoRoot, "LocalAppData");
  const expectedInstallDir = resolve(localAppData, "Programs", "Soto");

  try {
    process.env.LOCALAPPDATA = localAppData;
    delete process.env.USERPROFILE;

    const installed = installAndLaunchWindows({
      repoRoot: fixture.repoRoot,
      runCommand(command, args, options) {
        calls.push({ command, args, stdio: options?.stdio, encoding: options?.encoding });
        if (command === "robocopy") return { status: 1, stdout: "copied", stderr: "" };
        return { status: 0, stdout: "", stderr: "" };
      },
      stdout: sink(),
    });

    assert.equal(installed, resolve(expectedInstallDir, "Soto.exe"));
    assert.deepEqual(calls[1].args, [fixture.appDir, expectedInstallDir, "/E"]);
  } finally {
    if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = originalLocalAppData;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
    fixture.cleanup();
  }
});

test("installAndLaunchWindows prefers the smoke package output for reload", () => {
  const fixture = createWinUnpackedFixture("apps/desktop/dist/smoke-win-package/win-unpacked");
  const calls = [];
  const installDir = resolve(fixture.repoRoot, "installed/Soto");

  try {
    installAndLaunchWindows({
      repoRoot: fixture.repoRoot,
      installDir,
      runCommand(command, args, options) {
        calls.push({ command, args, stdio: options?.stdio, encoding: options?.encoding });
        if (command === "robocopy") return { status: 1, stdout: "copied", stderr: "" };
        return { status: 0, stdout: "", stderr: "" };
      },
      stdout: sink(),
    });

    assert.deepEqual(calls[1].args, [fixture.appDir, installDir, "/E"]);
  } finally {
    fixture.cleanup();
  }
});

test("installAndLaunchWindows fails on robocopy failure status", () => {
  const fixture = createWinUnpackedFixture();
  try {
    assert.throws(
      () =>
        installAndLaunchWindows({
          repoRoot: fixture.repoRoot,
          installDir: resolve(fixture.repoRoot, "installed/Soto"),
          runCommand(command) {
            if (command === "robocopy") return { status: 8, stdout: "", stderr: "copy failed" };
            return { status: 0, stdout: "", stderr: "" };
          },
          stdout: sink(),
        }),
      /robocopy .* failed/,
    );
  } finally {
    fixture.cleanup();
  }
});

test("Windows package smoke builds Native AOT and isolated Electron smoke package before verification by default", () => {
  const commands = [];
  const stdout = writer();
  const stderr = writer();
  const repoRoot = mkdtempSync(join(tmpdir(), "soto-win-package-"));

  const status = windowsPackageMain([], {
    repoRoot,
    platform: "win32",
    arch: "x64",
    stdout: stdout.stream,
    stderr: stderr.stream,
    runCommand(command, args) {
      commands.push([command, args]);
      return { status: 0, stdout: "", stderr: "" };
    },
  });

  assert.equal(status, 1, "verification should still fail in the empty temp repo");
  assert.deepEqual(commands, [
    [
      "dotnet",
      [
        "publish",
        "native/windows/SotoWinNative.csproj",
        "-c",
        "Release",
        "-r",
        "win-x64",
        "--self-contained",
        "-p:PublishAot=true",
      ],
    ],
    ["cmd.exe", ["/d", "/s", "/c", "pnpm --filter @soto/desktop run rebuild:electron"]],
    ["cmd.exe", ["/d", "/s", "/c", "pnpm --filter @soto/desktop exec electron-vite build"]],
    [
      "cmd.exe",
      [
        "/d",
        "/s",
        "/c",
        "pnpm --filter @soto/desktop exec electron-builder --win --x64 -c.directories.output=dist/smoke-win-package",
      ],
    ],
  ]);
  assert.match(stderr.text(), /Native AOT publish DLL not found/);
});

test("Windows package smoke default build mode is host-gated to Windows x64", () => {
  const commands = [];
  const stdout = writer();
  const stderr = writer();
  const repoRoot = mkdtempSync(join(tmpdir(), "soto-win-package-"));

  const status = windowsPackageMain([], {
    repoRoot,
    platform: "darwin",
    arch: "arm64",
    stdout: stdout.stream,
    stderr: stderr.stream,
    runCommand(command, args) {
      commands.push([command, args]);
      return { status: 0, stdout: "", stderr: "" };
    },
  });

  assert.equal(status, 1);
  assert.deepEqual(commands, []);
  assert.match(stderr.text(), /Windows package smoke must run on Windows x64/);
});

test("Windows package smoke help documents verify-only mode", () => {
  const stdout = writer();
  const stderr = writer();

  const status = windowsPackageMain(["--help"], {
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(status, 0);
  assert.match(stdout.text(), /--verify-only/);
  assert.match(stdout.text(), /--reload/);
});

test("Windows package smoke reports externalized main-process deps missing from app.asar", () => {
  const missing = missingPackagedRuntimeDependencies(
    [
      'const path = require("node:path");',
      'const electron = require("electron");',
      'const sqlite = require("better-sqlite3");',
      'const WebSocket = require("ws");',
      'const local = require("./local-module.js");',
      'const scoped = require("@scope/pkg/subpath");',
    ].join("\n"),
    [
      "\\node_modules\\better-sqlite3\\package.json",
      "\\node_modules\\@scope\\pkg\\package.json",
    ],
  );

  assert.deepEqual(missing, ["ws"]);
});
