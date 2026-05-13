#!/usr/bin/env node

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_BUNDLE_ID = "org.sotoapp.sotoapp";
const DEFAULT_DESTINATION = "/Applications/Soto.app";
const DEFAULT_SOURCE = join("target", "release", "bundle", "macos", "Soto.app");
const REQUIRED_ENTITLEMENTS = ["com.apple.security.device.audio-input"];

const STOP_PROCESS_COMMANDS = [
  { command: "pkill", args: ["-x", "soto-desktop"], optional: true },
  { command: "pkill", args: ["-x", "Soto"], optional: true },
  { command: "pkill", args: ["-x", "SotoMac"], optional: true },
];

function resolveFromRepo(repoRoot, filePath) {
  return isAbsolute(filePath) ? filePath : resolve(repoRoot, filePath);
}

function formatCommand(command, args = []) {
  return [command, ...args].map((part) => (part.includes(" ") ? JSON.stringify(part) : part)).join(" ");
}

export function parseCliArgs(argv) {
  const parsed = {
    destination: DEFAULT_DESTINATION,
    dryRun: false,
    expectedBundleId: DEFAULT_BUNDLE_ID,
    help: false,
    requireDeveloperId: true,
    skipBuild: false,
    source: DEFAULT_SOURCE,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }

    if (arg === "--skip-build") {
      parsed.skipBuild = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    if (arg === "--source" || arg === "--destination" || arg === "--expected-bundle-id") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${arg} requires a value`);
      }
      if (arg === "--source") {
        parsed.source = value;
      } else if (arg === "--destination") {
        parsed.destination = value;
      } else {
        parsed.expectedBundleId = value;
      }
      index += 1;
      continue;
    }

    if (arg.startsWith("--source=")) {
      parsed.source = arg.slice("--source=".length);
      continue;
    }

    if (arg.startsWith("--destination=")) {
      parsed.destination = arg.slice("--destination=".length);
      continue;
    }

    if (arg.startsWith("--expected-bundle-id=")) {
      parsed.expectedBundleId = arg.slice("--expected-bundle-id=".length);
      continue;
    }

    throw new Error(`Unknown script argument ${arg}`);
  }

  return parsed;
}

export function buildCanonicalInstallPlan({ repoRoot, args }) {
  const sourceAppPath = resolveFromRepo(repoRoot, args.source);
  const destinationAppPath = args.destination;
  const installCommands = [
    { command: "rm", args: ["-rf", destinationAppPath] },
    { command: "ditto", args: [sourceAppPath, destinationAppPath] },
  ];

  return {
    buildCommand: args.skipBuild ? null : { command: "pnpm", args: ["build:mac:signed"] },
    destinationAppPath,
    expectedBundleId: args.expectedBundleId,
    installCommands,
    requireDeveloperId: args.requireDeveloperId,
    requiredEntitlements: REQUIRED_ENTITLEMENTS,
    sourceAppPath,
    stopProcessCommands: STOP_PROCESS_COMMANDS,
  };
}

function usage() {
  return `Usage:
  pnpm app:install-canonical [--dry-run] [--skip-build] [--source <Soto.app>] [--destination <Soto.app>]

Builds the Developer ID signed macOS bundle, installs it as the single TCC test identity, and verifies:
  destination: /Applications/Soto.app
  bundle id:   org.sotoapp.sotoapp
  signing:     Developer ID Application
  entitlement: com.apple.security.device.audio-input

Default build command:
  pnpm build:mac:signed
`;
}

function assertMacOS(platform = process.platform) {
  if (platform !== "darwin") {
    throw new Error("Canonical macOS app installation must run on macOS.");
  }
}

function runCommandOrThrow(command, args, { cwd, optional = false, runCommand = spawnSync, stdio = "pipe" } = {}) {
  const result = runCommand(command, args, {
    cwd,
    encoding: "utf8",
    stdio,
  });

  if (result.error) {
    throw result.error;
  }

  const status = result.status ?? 1;
  if (status !== 0 && !(optional && status === 1)) {
    const output = stdio === "pipe" ? `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() : "";
    throw new Error(`${formatCommand(command, args)} failed${output ? `: ${output}` : ""}`);
  }

  return stdio === "pipe" ? `${result.stdout ?? ""}${result.stderr ?? ""}` : "";
}

function readBundleIdentifier(appPath, runCommand) {
  return runCommandOrThrow(
    "/usr/libexec/PlistBuddy",
    ["-c", "Print :CFBundleIdentifier", join(appPath, "Contents", "Info.plist")],
    { runCommand },
  ).trim();
}

function readCodesignInfo(appPath, runCommand) {
  return runCommandOrThrow("codesign", ["-dv", "--verbose=4", appPath], { runCommand });
}

function readCodesignEntitlements(appPath, runCommand) {
  return runCommandOrThrow("codesign", ["-d", "--entitlements", ":-", appPath], { runCommand });
}

function verifyInstalledApp(plan, runCommand) {
  const bundleIdentifier = readBundleIdentifier(plan.destinationAppPath, runCommand);
  if (bundleIdentifier !== plan.expectedBundleId) {
    throw new Error(
      `Installed app bundle id is ${bundleIdentifier}; expected ${plan.expectedBundleId}.`,
    );
  }

  const codesignInfo = readCodesignInfo(plan.destinationAppPath, runCommand);
  if (!codesignInfo.includes(`Identifier=${plan.expectedBundleId}`)) {
    throw new Error(`codesign identity does not report Identifier=${plan.expectedBundleId}.`);
  }
  if (plan.requireDeveloperId && !codesignInfo.includes("Authority=Developer ID Application:")) {
    throw new Error("Installed app is not signed with a Developer ID Application certificate.");
  }

  const entitlements = readCodesignEntitlements(plan.destinationAppPath, runCommand);
  for (const entitlement of plan.requiredEntitlements) {
    const entitlementPattern = new RegExp(`<key>${entitlement}</key>\\s*<true\\s*/>`);
    if (!entitlementPattern.test(entitlements)) {
      throw new Error(`Installed app is missing required entitlement ${entitlement}.`);
    }
  }

  return {
    bundleIdentifier,
    codesignInfo,
    entitlements,
  };
}

function printDryRun(plan, stdout) {
  stdout.write("Canonical macOS app install plan:\n");
  for (const item of plan.stopProcessCommands) {
    stdout.write(`  ${formatCommand(item.command, item.args)}\n`);
  }
  if (plan.buildCommand) {
    stdout.write(`  ${formatCommand(plan.buildCommand.command, plan.buildCommand.args)}\n`);
  }
  for (const item of plan.installCommands) {
    stdout.write(`  ${formatCommand(item.command, item.args)}\n`);
  }
  stdout.write(`  verify bundle id = ${plan.expectedBundleId}\n`);
  stdout.write("  verify signing authority contains Developer ID Application\n");
  for (const entitlement of plan.requiredEntitlements) {
    stdout.write(`  verify entitlement ${entitlement} = true\n`);
  }
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

    const plan = buildCanonicalInstallPlan({ repoRoot, args });
    if (args.dryRun) {
      printDryRun(plan, stdout);
      return 0;
    }

    for (const item of plan.stopProcessCommands) {
      runCommandOrThrow(item.command, item.args, {
        cwd: repoRoot,
        optional: item.optional,
        runCommand,
      });
    }

    if (plan.buildCommand) {
      runCommandOrThrow(plan.buildCommand.command, plan.buildCommand.args, {
        cwd: repoRoot,
        runCommand,
        stdio: "inherit",
      });
    }

    if (!existsSync(plan.sourceAppPath)) {
      throw new Error(`Missing signed app bundle at ${plan.sourceAppPath}.`);
    }

    for (const item of plan.installCommands) {
      runCommandOrThrow(item.command, item.args, { cwd: repoRoot, runCommand, stdio: "inherit" });
    }

    const verification = verifyInstalledApp(plan, runCommand);
    stdout.write(`Installed canonical Soto app at ${plan.destinationAppPath}\n`);
    stdout.write(`Bundle id: ${verification.bundleIdentifier}\n`);
    stdout.write("Signing: Developer ID Application verified\n");
    stdout.write("Entitlements: audio input verified\n");
    stdout.write("Launch manually with: open /Applications/Soto.app\n");
    return 0;
  } catch (error) {
    stderr.write(`Canonical macOS app install failed: ${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
