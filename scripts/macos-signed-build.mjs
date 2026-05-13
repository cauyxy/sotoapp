#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_SECRETS_DIR = "signing-secrets";

const SECRET_FILES = {
  APPLE_SIGNING_IDENTITY: "apple-signing-identity",
  APPLE_API_KEY: "apple-api-key",
  APPLE_API_ISSUER: "apple-api-issuer",
  APPLE_API_KEY_PATH: "apple-api-key-path",
  TAURI_SIGNING_PRIVATE_KEY: "tauri-signing-private-key",
};

function stripLineBreaks(value) {
  return value.replace(/^[\r\n]+|[\r\n]+$/g, "");
}

function expandHome(filePath) {
  if (filePath === "~") {
    return homedir();
  }
  if (filePath.startsWith("~/")) {
    return join(homedir(), filePath.slice(2));
  }
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
} = {}) {
  const signingIdentity = readSecretFile(
    join(secretsDir, SECRET_FILES.APPLE_SIGNING_IDENTITY),
    "Apple signing identity",
  );
  const apiKey = readSecretFile(join(secretsDir, SECRET_FILES.APPLE_API_KEY), "App Store Connect API key id");
  const apiIssuer = readSecretFile(
    join(secretsDir, SECRET_FILES.APPLE_API_ISSUER),
    "App Store Connect API issuer",
  );
  const apiKeyPath = readSecretFile(
    join(secretsDir, SECRET_FILES.APPLE_API_KEY_PATH),
    "App Store Connect private key path",
  );
  const tauriSigningPrivateKey = readSecretFile(
    join(secretsDir, SECRET_FILES.TAURI_SIGNING_PRIVATE_KEY),
    "Tauri updater signing private key",
  );

  return {
    APPLE_SIGNING_IDENTITY: signingIdentity,
    APPLE_API_KEY: apiKey,
    APPLE_API_ISSUER: apiIssuer,
    APPLE_API_KEY_PATH: resolveAppleApiKeyPath(apiKeyPath, repoRoot, secretsDir),
    TAURI_SIGNING_PRIVATE_KEY: tauriSigningPrivateKey,
  };
}

export function buildTauriArgs(tauriArgs = []) {
  return ["tauri", "build", "--bundles", "app,dmg", "--ci", ...tauriArgs];
}

export function parseCliArgs(argv) {
  const parsed = {
    dryRun: false,
    help: false,
    secretsDir: undefined,
    tauriArgs: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--") {
      parsed.tauriArgs = argv.slice(index + 1);
      break;
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
      if (!value) {
        throw new Error("--secrets-dir requires a path");
      }
      parsed.secretsDir = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--secrets-dir=")) {
      parsed.secretsDir = arg.slice("--secrets-dir=".length);
      continue;
    }

    throw new Error(`Unknown script argument ${arg}. Pass Tauri arguments after --.`);
  }

  return parsed;
}

function assertMacOS(platform = process.platform) {
  if (platform !== "darwin") {
    throw new Error("Signed macOS packaging must run on macOS.");
  }
}

function verifySigningIdentity(identity, runCommand = spawnSync) {
  const result = runCommand("security", ["find-identity", "-v", "-p", "codesigning"], {
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error("Unable to query macOS code signing identities with security(1).");
  }

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (!output.includes(identity)) {
    throw new Error("The configured Apple signing identity is not present in the current keychain.");
  }
}

function usage() {
  return `Usage:
  pnpm build:mac:signed [--dry-run] [--secrets-dir <path>] [-- <tauri build args>]

Reads Apple signing and notarization inputs from signing-secrets/ and runs:
  pnpm tauri build -- --bundles app,dmg --ci

Required files:
  signing-secrets/apple-signing-identity
  signing-secrets/apple-api-key
  signing-secrets/apple-api-issuer
  signing-secrets/apple-api-key-path
`;
}

function runBuild({ repoRoot, signingEnv, tauriArgs, runCommand = spawnSync }) {
  const result = runCommand("pnpm", buildTauriArgs(tauriArgs), {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...signingEnv,
    },
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 1;
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

    const secretsDir = args.secretsDir
      ? resolve(repoRoot, args.secretsDir)
      : resolve(repoRoot, DEFAULT_SECRETS_DIR);
    const signingEnv = loadSigningEnvironment({ repoRoot, secretsDir });
    verifySigningIdentity(signingEnv.APPLE_SIGNING_IDENTITY, runCommand);

    if (args.dryRun) {
      stdout.write("macOS signing inputs are present and the configured identity is available in keychain.\n");
      stdout.write(`Build command: pnpm ${buildTauriArgs(args.tauriArgs).join(" ")}\n`);
      return 0;
    }

    return runBuild({ repoRoot, signingEnv, tauriArgs: args.tauriArgs, runCommand });
  } catch (error) {
    stderr.write(`macOS signed build setup failed: ${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
