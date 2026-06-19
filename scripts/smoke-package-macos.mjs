#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PRODUCT_NAME = "Soto";
const PLATFORM = "mac-arm64";
const INSTALL_DIR = "/Applications";
const REQUIRED_EXPORTS = [
  "_soto_app_activate",
  "_soto_app_frontmost",
  "_soto_app_frontmost_window_bounds",
  "_soto_audio_is_output_muted",
  "_soto_audio_set_output_muted",
  "_soto_ax_capture_focused",
  "_soto_ax_context_free",
  "_soto_ax_is_trusted",
  "_soto_clipboard_copy_user_text",
  "_soto_clipboard_prepare_paste_text",
  "_soto_clipboard_restore_after_paste",
  "_soto_focus_probe",
  "_soto_hook_install",
  "_soto_hook_next_event",
  "_soto_hook_shutdown",
  "_soto_open_permission_settings",
  "_soto_permission_status_kind",
  "_soto_request_permission",
  "_soto_send_paste",
  "_soto_window_title",
];

function repoPath(repoRoot, relativePath) {
  return resolve(repoRoot, relativePath);
}

function readDesktopVersion(repoRoot) {
  const packageJson = JSON.parse(readFileSync(repoPath(repoRoot, "apps/desktop/package.json"), "utf8"));
  return packageJson.version;
}

function artifactPaths(repoRoot) {
  const version = readDesktopVersion(repoRoot);
  const appBundle = repoPath(repoRoot, `apps/desktop/dist/${PLATFORM}/${PRODUCT_NAME}.app`);
  const nativeDylib = join(appBundle, "Contents/Resources/native/libSotoMacNative.dylib");

  return {
    appBundle,
    nativeDylib,
    dmg: repoPath(repoRoot, `apps/desktop/dist/${PRODUCT_NAME}-${version}-arm64.dmg`),
    zip: repoPath(repoRoot, `apps/desktop/dist/${PRODUCT_NAME}-${version}-arm64-mac.zip`),
    latestMac: repoPath(repoRoot, "apps/desktop/dist/latest-mac.yml"),
  };
}

export function parseCliArgs(argv) {
  const parsed = {
    help: false,
    skipCodesign: false,
    skipNative: false,
    verifyOnly: false,
    reload: false,
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--skip-codesign") {
      parsed.skipCodesign = true;
    } else if (arg === "--skip-native") {
      parsed.skipNative = true;
    } else if (arg === "--verify-only") {
      parsed.verifyOnly = true;
    } else if (arg === "--reload") {
      parsed.reload = true;
    } else {
      throw new Error(`Unknown script argument ${arg}`);
    }
  }

  return parsed;
}

function usage() {
  return `Usage:
  pnpm smoke:package:mac [--verify-only] [--skip-native] [--skip-codesign] [--reload]

Builds native/macos, runs the local Electron package command, then verifies the
macOS package artifacts that are useful for local smoke testing:
  - dist/${PLATFORM}/${PRODUCT_NAME}.app exists
  - dist/${PRODUCT_NAME}-<version>-arm64.dmg exists
  - native libSotoMacNative.dylib is staged inside the app
  - the app bundle passes codesign verification
  - the staged dylib is arm64 and exports the expected soto_* C ABI symbols

With --reload, after verification passes the script reinstalls the verified
bundle from dist/ for a real launch smoke: kill any running ${PRODUCT_NAME} (pkill -x),
replace ${INSTALL_DIR}/${PRODUCT_NAME}.app via ditto, then open it. Install only runs
when verification succeeds, so a broken bundle is never pushed to ${INSTALL_DIR}.
(With --verify-only the staged bundle is reused as-is, not rebuilt first.)

This is a local package smoke, not a notarized release gate.
`;
}

function assertSupportedHost(platform = process.platform, arch = process.arch) {
  if (platform !== "darwin") {
    throw new Error("macOS package smoke must run on macOS.");
  }
  if (arch !== "arm64") {
    throw new Error("macOS package smoke is wired for Apple Silicon arm64 only.");
  }
}

function runStep(command, args, options = {}) {
  const result = (options.runCommand ?? spawnSync)(command, args, {
    cwd: options.cwd,
    stdio: options.stdio ?? "inherit",
    encoding: options.encoding,
  });

  if (result.error) throw result.error;
  return result;
}

function requireOk(result, label) {
  if ((result.status ?? 1) === 0) return;
  const detail = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  throw new Error(`${label} failed${detail ? `:\n${detail}` : ""}`);
}

function requireFile(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} not found at ${path}`);
  }
}

function buildNativeMacDylib(repoRoot, runCommand) {
  requireOk(
    runStep("swift", ["build", "--package-path", "native/macos", "-c", "release"], {
      cwd: repoRoot,
      runCommand,
    }),
    "swift build",
  );
}

function buildDesktopPackage(repoRoot, runCommand) {
  requireOk(
    runStep("pnpm", ["--filter", "@soto/desktop", "run", "package:smoke:mac"], {
      cwd: repoRoot,
      runCommand,
    }),
    "pnpm --filter @soto/desktop run package:smoke:mac",
  );
}

function captureCommand(command, args, runCommand) {
  const result = runStep(command, args, {
    runCommand,
    stdio: "pipe",
    encoding: "utf8",
  });
  requireOk(result, `${command} ${args.join(" ")}`);
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function verifyArtifacts({ repoRoot, skipCodesign, runCommand }) {
  const paths = artifactPaths(repoRoot);
  requireFile(paths.appBundle, "Packaged app bundle");
  requireFile(paths.nativeDylib, "Packaged native dylib");
  requireFile(paths.dmg, "DMG artifact");
  requireFile(paths.zip, "macOS zip artifact");
  requireFile(paths.latestMac, "electron-updater mac feed");

  if (!skipCodesign) {
    captureCommand(
      "codesign",
      ["--verify", "--deep", "--strict", "--verbose=2", paths.appBundle],
      runCommand,
    );
  }

  const lipoOutput = captureCommand("lipo", ["-info", paths.nativeDylib], runCommand);
  if (!lipoOutput.includes("arm64")) {
    throw new Error(`Packaged dylib is not arm64:\n${lipoOutput.trim()}`);
  }

  const nmOutput = captureCommand("nm", ["-gU", paths.nativeDylib], runCommand);
  // Match the trailing symbol token per line (real `nm -gU` lines are
  // "<addr> T _soto_x"; the test fixture is the bare symbol). A flat
  // substring scan would let a longer symbol mask a shorter one
  // (e.g. _soto_app_frontmost_window_bounds masking _soto_app_frontmost).
  const exportedSymbols = new Set(
    nmOutput
      .split("\n")
      .map((line) => line.trim().split(/\s+/).pop())
      .filter(Boolean),
  );
  const missing = REQUIRED_EXPORTS.filter((symbol) => !exportedSymbols.has(symbol));
  if (missing.length > 0) {
    throw new Error(`Packaged dylib is missing required exports: ${missing.join(", ")}`);
  }

  return paths;
}

export function installAndLaunch({ paths, runCommand, stdout }) {
  const installedApp = posix.join(INSTALL_DIR, `${PRODUCT_NAME}.app`);
  stdout?.write(`Reinstalling ${PRODUCT_NAME} into ${INSTALL_DIR} and launching...\n`);

  // Stop any running instance. pkill exits non-zero when nothing matched, which
  // is expected (the app may not be running), so we do not requireOk it.
  runStep("pkill", ["-x", PRODUCT_NAME], { runCommand, stdio: "ignore" });

  // Replace the installed bundle. ditto preserves the code signature and
  // extended attributes; a plain cp -R can corrupt signing.
  requireOk(runStep("rm", ["-rf", installedApp], { runCommand }), `rm -rf ${installedApp}`);
  requireOk(
    runStep("ditto", [paths.appBundle, installedApp], { runCommand }),
    `ditto ${paths.appBundle} ${installedApp}`,
  );

  // Launch the freshly installed bundle.
  requireOk(
    runStep("open", ["--env", "SOTO_LOG_PROFILE=smoke", installedApp], { runCommand }),
    `open ${installedApp}`,
  );

  return installedApp;
}

export function main(argv = process.argv.slice(2), context = {}) {
  const repoRoot = context.repoRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const platform = context.platform ?? process.platform;
  const arch = context.arch ?? process.arch;
  const runCommand = context.runCommand ?? spawnSync;
  const stdout = context.stdout ?? process.stdout;
  const stderr = context.stderr ?? process.stderr;

  try {
    const args = parseCliArgs(argv);
    if (args.help) {
      stdout.write(usage());
      return 0;
    }

    assertSupportedHost(platform, arch);

    if (!args.verifyOnly) {
      if (!args.skipNative) buildNativeMacDylib(repoRoot, runCommand);
      buildDesktopPackage(repoRoot, runCommand);
    }

    const paths = verifyArtifacts({
      repoRoot,
      skipCodesign: args.skipCodesign,
      runCommand,
    });

    const installedApp = args.reload
      ? installAndLaunch({ paths, runCommand, stdout })
      : null;

    stdout.write(`macOS package smoke passed:\n`);
    stdout.write(`  app: ${paths.appBundle}\n`);
    stdout.write(`  dmg: ${paths.dmg}\n`);
    stdout.write(`  native: ${paths.nativeDylib}\n`);
    if (installedApp) stdout.write(`  installed: ${installedApp} (launched)\n`);
    return 0;
  } catch (error) {
    stderr.write(`macOS package smoke failed: ${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
