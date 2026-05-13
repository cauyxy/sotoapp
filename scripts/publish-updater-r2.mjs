#!/usr/bin/env node

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_BUCKET = "soto-installer";
const DEFAULT_WRANGLER_BIN = "wrangler";

const CONTENT_TYPES = {
  dmg: "application/octet-stream",
  exe: "application/octet-stream",
  json: "application/json; charset=utf-8",
  sig: "text/plain; charset=utf-8",
  tarGz: "application/gzip",
};

function artifactNames(version) {
  return {
    darwin: {
      platform: "darwin-aarch64",
      stagingDir: "artifacts-darwin",
      updater: `Soto_${version}_darwin_aarch64.app.tar.gz`,
      signature: `Soto_${version}_darwin_aarch64.app.tar.gz.sig`,
      installer: `Soto_${version}_darwin_aarch64.dmg`,
    },
    windows: {
      platform: "windows-x86_64",
      stagingDir: "artifacts-windows",
      updater: `Soto_${version}_windows_x86_64-setup.exe`,
      signature: `Soto_${version}_windows_x86_64-setup.exe.sig`,
    },
  };
}

function artifactKey(version, platform, fileName) {
  return `artifacts/${version}/${platform}/${fileName}`;
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function copyIfPresent(source, destination) {
  if (!existsSync(source)) {
    return false;
  }

  ensureDir(dirname(destination));
  copyFileSync(source, destination);
  return true;
}

function findWindowsInstaller(nsisDir, version) {
  if (!existsSync(nsisDir)) {
    return null;
  }

  const installers = readdirSync(nsisDir)
    .filter((fileName) => fileName.endsWith(".exe") && !fileName.endsWith(".sig"))
    .sort();

  return installers.find((fileName) => fileName === `Soto_${version}_x64-setup.exe`)
    ?? installers.find((fileName) => fileName.includes(`_${version}_`))
    ?? installers[0]
    ?? null;
}

function artifactItem({ repoRoot, version, platform, stagingDir, fileName, contentType }) {
  return {
    path: join(repoRoot, stagingDir, fileName),
    key: artifactKey(version, platform, fileName),
    contentType,
  };
}

function stagedArtifactItems({ repoRoot, version }) {
  const names = artifactNames(version);
  const candidates = [
    artifactItem({
      repoRoot,
      version,
      platform: names.darwin.platform,
      stagingDir: names.darwin.stagingDir,
      fileName: names.darwin.updater,
      contentType: CONTENT_TYPES.tarGz,
    }),
    artifactItem({
      repoRoot,
      version,
      platform: names.darwin.platform,
      stagingDir: names.darwin.stagingDir,
      fileName: names.darwin.signature,
      contentType: CONTENT_TYPES.sig,
    }),
    artifactItem({
      repoRoot,
      version,
      platform: names.darwin.platform,
      stagingDir: names.darwin.stagingDir,
      fileName: names.darwin.installer,
      contentType: CONTENT_TYPES.dmg,
    }),
    artifactItem({
      repoRoot,
      version,
      platform: names.windows.platform,
      stagingDir: names.windows.stagingDir,
      fileName: names.windows.updater,
      contentType: CONTENT_TYPES.exe,
    }),
    artifactItem({
      repoRoot,
      version,
      platform: names.windows.platform,
      stagingDir: names.windows.stagingDir,
      fileName: names.windows.signature,
      contentType: CONTENT_TYPES.sig,
    }),
  ];

  return candidates.filter((item) => existsSync(item.path));
}

export function stageLocalArtifacts({ repoRoot = process.cwd(), version }) {
  if (!version) {
    throw new Error("version is required");
  }

  const names = artifactNames(version);
  const bundleRoot = join(repoRoot, "target", "release", "bundle");

  copyIfPresent(
    join(bundleRoot, "macos", "Soto.app.tar.gz"),
    join(repoRoot, names.darwin.stagingDir, names.darwin.updater)
  );
  copyIfPresent(
    join(bundleRoot, "macos", "Soto.app.tar.gz.sig"),
    join(repoRoot, names.darwin.stagingDir, names.darwin.signature)
  );
  copyIfPresent(
    join(bundleRoot, "dmg", `Soto_${version}_aarch64.dmg`),
    join(repoRoot, names.darwin.stagingDir, names.darwin.installer)
  );

  const windowsInstaller = findWindowsInstaller(join(bundleRoot, "nsis"), version);
  if (windowsInstaller) {
    copyIfPresent(
      join(bundleRoot, "nsis", windowsInstaller),
      join(repoRoot, names.windows.stagingDir, names.windows.updater)
    );
    copyIfPresent(
      join(bundleRoot, "nsis", `${windowsInstaller}.sig`),
      join(repoRoot, names.windows.stagingDir, names.windows.signature)
    );
  }

  return stagedArtifactItems({ repoRoot, version });
}

export function buildUploadPlan({ repoRoot = process.cwd(), version }) {
  if (!version) {
    throw new Error("version is required");
  }

  const artifacts = stagedArtifactItems({ repoRoot, version });
  const latestPath = join(repoRoot, "latest.json");

  if (!existsSync(latestPath)) {
    throw new Error("latest.json is missing; run scripts/generate-latest-json.mjs first");
  }

  return [
    ...artifacts,
    {
      path: latestPath,
      key: "latest.json",
      contentType: CONTENT_TYPES.json,
    },
  ];
}

export function buildWranglerPutArgs({ bucket, item, wranglerBin = DEFAULT_WRANGLER_BIN }) {
  const prefix = wranglerBin === "wrangler" || wranglerBin.endsWith("/wrangler")
    ? [wranglerBin]
    : [wranglerBin, "wrangler"];

  return [
    ...prefix,
    "r2",
    "object",
    "put",
    `${bucket}/${item.key}`,
    "--file",
    item.path,
    "--content-type",
    item.contentType,
    "--remote",
  ];
}

export function parseCliArgs(argv, env = process.env) {
  const parsed = {
    allowPartial: false,
    bucket: DEFAULT_BUCKET,
    dryRun: false,
    help: false,
    skipStage: false,
    version: env.VERSION,
    wranglerBin: DEFAULT_WRANGLER_BIN,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--allow-partial") {
      parsed.allowPartial = true;
      continue;
    }

    if (arg === "--bucket") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--bucket requires a value");
      }
      parsed.bucket = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--bucket=")) {
      parsed.bucket = arg.slice("--bucket=".length);
      continue;
    }

    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    if (arg === "--skip-stage") {
      parsed.skipStage = true;
      continue;
    }

    if (arg === "--version") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--version requires a value");
      }
      parsed.version = value.replace(/^v/, "");
      index += 1;
      continue;
    }

    if (arg.startsWith("--version=")) {
      parsed.version = arg.slice("--version=".length).replace(/^v/, "");
      continue;
    }

    if (arg === "--wrangler-bin") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--wrangler-bin requires a value");
      }
      parsed.wranglerBin = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--wrangler-bin=")) {
      parsed.wranglerBin = arg.slice("--wrangler-bin=".length);
      continue;
    }

    throw new Error(`Unknown script argument ${arg}`);
  }

  if (parsed.version) {
    parsed.version = parsed.version.replace(/^v/, "");
  }

  return parsed;
}

function requiredUpdaterSignatureItems({ repoRoot, version }) {
  const names = artifactNames(version);
  return [
    {
      platform: names.darwin.platform,
      path: join(repoRoot, names.darwin.stagingDir, names.darwin.signature),
    },
    {
      platform: names.windows.platform,
      path: join(repoRoot, names.windows.stagingDir, names.windows.signature),
    },
  ];
}

function assertCompleteRelease({ repoRoot, version, allowPartial }) {
  if (allowPartial) {
    return;
  }

  const missingPlatforms = requiredUpdaterSignatureItems({ repoRoot, version })
    .filter((item) => !existsSync(item.path))
    .map((item) => item.platform);

  if (missingPlatforms.length > 0) {
    throw new Error(
      `Missing updater signatures for ${missingPlatforms.join(", ")}. ` +
      "Pass --allow-partial only when intentionally publishing a platform-limited update."
    );
  }
}

function runGenerateLatestJson({ repoRoot, version, runCommand }) {
  const result = runCommand(process.execPath, ["scripts/generate-latest-json.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      VERSION: version,
    },
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    throw new Error("latest.json generation failed");
  }
}

function usage() {
  return `Usage:
  VERSION=0.1.0 pnpm publish:update [--dry-run] [--allow-partial] [--bucket <bucket>]

Stages local Tauri bundle output into artifacts-darwin/ and artifacts-windows/,
regenerates latest.json, then uploads versioned artifacts plus latest.json to R2.

Default R2 bucket:
  ${DEFAULT_BUCKET}

Expected local bundle outputs:
  target/release/bundle/macos/Soto.app.tar.gz
  target/release/bundle/macos/Soto.app.tar.gz.sig
  target/release/bundle/dmg/Soto_<version>_aarch64.dmg
  target/release/bundle/nsis/Soto_<version>_x64-setup.exe
  target/release/bundle/nsis/Soto_<version>_x64-setup.exe.sig
`;
}

function writeDryRunPlan({ stdout, bucket, plan, wranglerBin }) {
  stdout.write(`Dry run: would upload ${plan.length} objects to R2 bucket ${bucket}.\n`);
  for (const item of plan) {
    stdout.write(`${item.key} <- ${item.path}\n`);
    stdout.write(`  ${buildWranglerPutArgs({ bucket, item, wranglerBin }).join(" ")}\n`);
  }
}

function runUploadPlan({ repoRoot, bucket, plan, wranglerBin, runCommand }) {
  for (const item of plan) {
    const commandLine = buildWranglerPutArgs({ bucket, item, wranglerBin });
    const [command, ...args] = commandLine;
    const result = runCommand(command, args, {
      cwd: repoRoot,
      stdio: "inherit",
    });

    if (result.error) {
      throw result.error;
    }

    if ((result.status ?? 1) !== 0) {
      throw new Error(`R2 upload failed for ${item.key}`);
    }
  }
}

export function main(argv = process.argv.slice(2), context = {}) {
  const repoRoot = context.repoRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const runCommand = context.runCommand ?? spawnSync;
  const stdout = context.stdout ?? process.stdout;
  const stderr = context.stderr ?? process.stderr;

  try {
    const args = parseCliArgs(argv);

    if (args.help) {
      stdout.write(usage());
      return 0;
    }

    if (!args.version) {
      throw new Error("VERSION env var or --version is required");
    }

    if (!args.skipStage) {
      stageLocalArtifacts({ repoRoot, version: args.version });
    }

    assertCompleteRelease({
      repoRoot,
      version: args.version,
      allowPartial: args.allowPartial,
    });
    runGenerateLatestJson({ repoRoot, version: args.version, runCommand });

    const plan = buildUploadPlan({ repoRoot, version: args.version });
    if (args.dryRun) {
      writeDryRunPlan({
        stdout,
        bucket: args.bucket,
        plan,
        wranglerBin: args.wranglerBin,
      });
      return 0;
    }

    runUploadPlan({
      repoRoot,
      bucket: args.bucket,
      plan,
      wranglerBin: args.wranglerBin,
      runCommand,
    });
    return 0;
  } catch (error) {
    stderr.write(`R2 updater publish failed: ${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
