#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_SECRETS_DIR = "signing-secrets";
const DEFAULT_ARCH = "arm64";
const APP_BUNDLE_CANDIDATES = [
  "apps/desktop/dist/mac-arm64/Soto.app",
  "apps/desktop/dist/mac/Soto.app",
  "apps/desktop/dist/mac-universal/Soto.app",
];

const SECRET_FILES = {
  APPLE_SIGNING_IDENTITY: "apple-signing-identity",
  APPLE_API_KEY_ID: "apple-api-key",
  APPLE_API_ISSUER: "apple-api-issuer",
  APPLE_API_KEY_PATH: "apple-api-key-path",
};
const ELECTRON_BUILDER_REJECTED_CERTIFICATE_PREFIX = "Developer ID Application:";

function stripLineBreaks(value) {
  return value.replace(/^[\r\n]+|[\r\n]+$/g, "");
}

function normalizeSigningIdentity(value) {
  const stripped = stripLineBreaks(value);
  if (stripped.startsWith(ELECTRON_BUILDER_REJECTED_CERTIFICATE_PREFIX)) {
    return stripped.slice(ELECTRON_BUILDER_REJECTED_CERTIFICATE_PREFIX.length).trimStart();
  }
  return stripped;
}

function expandHome(filePath) {
  if (filePath === "~") return homedir();
  if (filePath.startsWith("~/")) return join(homedir(), filePath.slice(2));
  return filePath;
}

function readSecretFile(filePath, label) {
  if (!existsSync(filePath)) {
    throw new Error(`Missing ${label} file at ${filePath}`);
  }

  const value = stripLineBreaks(readFileSync(filePath, "utf8"));
  if (value.length === 0) {
    throw new Error(`Missing ${label}: ${filePath} is empty`);
  }

  return value;
}

export function resolveAppleApiKeyPath(rawPath, repoRoot, secretsDir) {
  const expanded = expandHome(rawPath);
  const candidates = isAbsolute(expanded)
    ? [expanded]
    : [resolve(repoRoot, expanded), resolve(secretsDir, expanded)];
  const uniqueCandidates = [...new Set(candidates)];
  const resolvedPath = uniqueCandidates.find((candidate) => existsSync(candidate));

  if (!resolvedPath) {
    throw new Error(`Missing App Store Connect private key file. Checked: ${uniqueCandidates.join(", ")}`);
  }

  return resolvedPath;
}

export function loadSigningEnvironment({
  repoRoot = process.cwd(),
  secretsDir = resolve(repoRoot, DEFAULT_SECRETS_DIR),
  env = process.env,
} = {}) {
  const signingIdentity = env.CSC_NAME
    ?? readSecretFile(join(secretsDir, SECRET_FILES.APPLE_SIGNING_IDENTITY), "Apple signing identity");
  const apiKeyId = env.APPLE_API_KEY_ID
    ?? readSecretFile(join(secretsDir, SECRET_FILES.APPLE_API_KEY_ID), "App Store Connect API key id");
  const apiIssuer = env.APPLE_API_ISSUER
    ?? readSecretFile(join(secretsDir, SECRET_FILES.APPLE_API_ISSUER), "App Store Connect API issuer");
  const apiKeyPath = env.APPLE_API_KEY
    ?? readSecretFile(join(secretsDir, SECRET_FILES.APPLE_API_KEY_PATH), "App Store Connect private key path");

  return {
    CSC_NAME: normalizeSigningIdentity(signingIdentity),
    APPLE_API_KEY: resolveAppleApiKeyPath(apiKeyPath, repoRoot, secretsDir),
    APPLE_API_KEY_ID: apiKeyId,
    APPLE_API_ISSUER: apiIssuer,
  };
}

export function buildElectronBuilderArgs({
  arch = DEFAULT_ARCH,
  electronBuilderArgs = [],
} = {}) {
  return [
    "--filter",
    "@soto/desktop",
    "exec",
    "electron-builder",
    "--mac",
    `--${arch}`,
    "--publish",
    "never",
    "-c.forceCodeSigning=true",
    ...electronBuilderArgs,
  ];
}

export function parseCliArgs(argv) {
  const parsed = {
    arch: DEFAULT_ARCH,
    dryRun: false,
    help: false,
    secretsDir: undefined,
    skipNative: false,
    skipVerify: false,
    electronBuilderArgs: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--") {
      parsed.electronBuilderArgs = argv.slice(index + 1);
      break;
    }

    if (arg === "--arch") {
      const value = argv[index + 1];
      if (!value) throw new Error("--arch requires a value");
      parsed.arch = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--arch=")) {
      parsed.arch = arg.slice("--arch=".length);
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

    if (arg === "--secrets-dir") {
      const value = argv[index + 1];
      if (!value) throw new Error("--secrets-dir requires a path");
      parsed.secretsDir = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--secrets-dir=")) {
      parsed.secretsDir = arg.slice("--secrets-dir=".length);
      continue;
    }

    if (arg === "--skip-native") {
      parsed.skipNative = true;
      continue;
    }

    if (arg === "--skip-verify") {
      parsed.skipVerify = true;
      continue;
    }

    throw new Error(`Unknown script argument ${arg}. Pass Electron Builder arguments after --.`);
  }

  return parsed;
}

function assertMacOS(platform = process.platform) {
  if (platform !== "darwin") {
    throw new Error("Signed macOS packaging must run on macOS.");
  }
}

function assertSupportedArch(arch) {
  if (arch !== DEFAULT_ARCH) {
    throw new Error("Only arm64 macOS signed builds are wired today; add x64/universal native dylib packaging before changing --arch.");
  }
}

function verifySigningIdentity(identity, runCommand = spawnSync) {
  const result = runCommand("security", ["find-identity", "-v", "-p", "codesigning"], {
    encoding: "utf8",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error("Unable to query macOS code signing identities with security(1).");
  }

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (!output.includes(identity)) {
    throw new Error("The configured Apple signing identity is not present in the current keychain.");
  }
}

export function nativeMacDylibPath(repoRoot, arch = DEFAULT_ARCH) {
  const swiftArch = arch === "x64" ? "x86_64-apple-macosx" : "arm64-apple-macosx";
  return resolve(repoRoot, "native/macos/.build", swiftArch, "release/libSotoMacNative.dylib");
}

function runStep(command, args, options = {}) {
  const result = (options.runCommand ?? spawnSync)(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: options.stdio ?? "inherit",
    encoding: options.encoding,
  });

  if (result.error) throw result.error;
  return result.status ?? 1;
}

function buildNativeMacDylib({ repoRoot, arch, runCommand }) {
  const status = runStep(
    "swift",
    ["build", "--package-path", "native/macos", "-c", "release"],
    { cwd: repoRoot, runCommand },
  );
  if (status !== 0) return status;

  const dylibPath = nativeMacDylibPath(repoRoot, arch);
  if (!existsSync(dylibPath)) {
    throw new Error(`Swift build finished but ${dylibPath} was not found`);
  }
  return 0;
}

function buildDesktop({ repoRoot, signingEnv, arch, electronBuilderArgs, runCommand }) {
  const env = {
    ...process.env,
    ...signingEnv,
  };

  const rebuildStatus = runStep(
    "pnpm",
    ["--filter", "@soto/desktop", "run", "rebuild:electron"],
    { cwd: repoRoot, env, runCommand },
  );
  if (rebuildStatus !== 0) return rebuildStatus;

  const viteStatus = runStep(
    "pnpm",
    ["--filter", "@soto/desktop", "exec", "electron-vite", "build"],
    { cwd: repoRoot, env, runCommand },
  );
  if (viteStatus !== 0) return viteStatus;

  return runStep(
    "pnpm",
    buildElectronBuilderArgs({ arch, electronBuilderArgs }),
    { cwd: repoRoot, env, runCommand },
  );
}

function findAppBundle(repoRoot) {
  const candidates = APP_BUNDLE_CANDIDATES.map((candidate) => resolve(repoRoot, candidate));
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found) return found;
  throw new Error(`Signed bundle not found. Checked: ${candidates.join(", ")}`);
}

function runVerificationCommand(command, args, runCommand) {
  const result = runCommand(command, args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
    throw new Error(`${command} ${args.join(" ")} failed:\n${detail}`);
  }
}

export function verifySignedBundle({ repoRoot, runCommand = spawnSync } = {}) {
  const bundlePath = findAppBundle(repoRoot);
  const nativePath = join(bundlePath, "Contents/Resources/native/libSotoMacNative.dylib");
  if (!existsSync(nativePath)) {
    throw new Error(`Packaged native dylib not found at ${nativePath}`);
  }

  const updaterFeedPath = resolve(repoRoot, "apps/desktop/dist/latest-mac.yml");
  if (!existsSync(updaterFeedPath)) {
    throw new Error(`electron-updater feed not found at ${updaterFeedPath}`);
  }

  runVerificationCommand(
    "codesign",
    ["--verify", "--deep", "--strict", "--verbose=2", bundlePath],
    runCommand,
  );
  runVerificationCommand("xcrun", ["stapler", "validate", bundlePath], runCommand);

  return bundlePath;
}

function usage() {
  return `Usage:
  pnpm build:mac:signed [--dry-run] [--secrets-dir <path>] [--arch arm64] [--skip-native] [--skip-verify] [-- <electron-builder args>]

Builds native/macos, runs electron-vite, then runs electron-builder for a signed
and notarized macOS release. Signing and notarization inputs are read from
signing-secrets/ unless already provided by the environment.

Required files:
  signing-secrets/apple-signing-identity
  signing-secrets/apple-api-key
  signing-secrets/apple-api-issuer
  signing-secrets/apple-api-key-path
`;
}

export function main(argv = process.argv.slice(2), context = {}) {
  const repoRoot = context.repoRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const platform = context.platform ?? process.platform;
  const runCommand = context.runCommand ?? spawnSync;
  const stdout = context.stdout ?? process.stdout;
  const stderr = context.stderr ?? process.stderr;

  try {
    const args = parseCliArgs(argv);

    if (args.help) {
      stdout.write(usage());
      return 0;
    }

    assertMacOS(platform);
    assertSupportedArch(args.arch);

    const secretsDir = args.secretsDir
      ? resolve(repoRoot, args.secretsDir)
      : resolve(repoRoot, DEFAULT_SECRETS_DIR);
    const signingEnv = loadSigningEnvironment({ repoRoot, secretsDir });
    verifySigningIdentity(signingEnv.CSC_NAME, runCommand);

    if (args.dryRun) {
      stdout.write("macOS signing inputs are present and the configured identity is available in keychain.\n");
      if (!args.skipNative) {
        stdout.write(`Native dylib output: ${nativeMacDylibPath(repoRoot, args.arch)}\n`);
      }
      stdout.write(`Build command: pnpm ${buildElectronBuilderArgs({
        arch: args.arch,
        electronBuilderArgs: args.electronBuilderArgs,
      }).join(" ")}\n`);
      return 0;
    }

    if (!args.skipNative) {
      const nativeStatus = buildNativeMacDylib({
        repoRoot,
        arch: args.arch,
        runCommand,
      });
      if (nativeStatus !== 0) return nativeStatus;
    }

    const buildStatus = buildDesktop({
      repoRoot,
      signingEnv,
      arch: args.arch,
      electronBuilderArgs: args.electronBuilderArgs,
      runCommand,
    });
    if (buildStatus !== 0) return buildStatus;

    if (!args.skipVerify) {
      const bundlePath = verifySignedBundle({ repoRoot, runCommand });
      stdout.write(`Verified signed + stapled Electron bundle at ${bundlePath}\n`);
    }

    return 0;
  } catch (error) {
    stderr.write(`macOS signed Electron build failed: ${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
