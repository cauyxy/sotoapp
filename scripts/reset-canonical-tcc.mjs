#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_BUNDLE_ID = "org.sotoapp.sotoapp";
const CANONICAL_SERVICES = ["Microphone", "Accessibility"];

const STOP_PROCESS_COMMANDS = [
  { command: "pkill", args: ["-x", "soto-desktop"], optional: true },
  { command: "pkill", args: ["-x", "Soto"], optional: true },
  { command: "pkill", args: ["-x", "SotoMac"], optional: true },
];

function formatCommand(command, args = []) {
  return [command, ...args].map((part) => (part.includes(" ") ? JSON.stringify(part) : part)).join(" ");
}

export function parseCliArgs(argv) {
  const parsed = {
    bundleId: DEFAULT_BUNDLE_ID,
    dryRun: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    if (arg === "--bundle-id") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--bundle-id requires a value");
      }
      parsed.bundleId = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--bundle-id=")) {
      parsed.bundleId = arg.slice("--bundle-id=".length);
      continue;
    }

    throw new Error(`Unknown script argument ${arg}`);
  }

  return parsed;
}

export function buildTccResetPlan(args) {
  return {
    bundleId: args.bundleId,
    resetCommands: CANONICAL_SERVICES.map((service) => ({
      command: "tccutil",
      args: ["reset", service, args.bundleId],
    })),
    services: CANONICAL_SERVICES,
    stopProcessCommands: STOP_PROCESS_COMMANDS,
  };
}

function usage() {
  return `Usage:
  pnpm app:reset-tcc [--dry-run] [--bundle-id <id>]

Quits known Soto processes and resets the canonical macOS permissions for:
  org.sotoapp.sotoapp

Services:
  Microphone
  Accessibility
`;
}

function assertMacOS(platform = process.platform) {
  if (platform !== "darwin") {
    throw new Error("TCC reset must run on macOS.");
  }
}

function runCommandOrThrow(command, args, { optional = false, runCommand = spawnSync } = {}) {
  const result = runCommand(command, args, {
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.error) {
    throw result.error;
  }

  const status = result.status ?? 1;
  if (status !== 0 && !(optional && status === 1)) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    throw new Error(`${formatCommand(command, args)} failed${output ? `: ${output}` : ""}`);
  }

  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function printDryRun(plan, stdout) {
  stdout.write("Canonical TCC reset plan:\n");
  for (const item of plan.stopProcessCommands) {
    stdout.write(`  ${formatCommand(item.command, item.args)}\n`);
  }
  for (const item of plan.resetCommands) {
    stdout.write(`  ${formatCommand(item.command, item.args)}\n`);
  }
}

export function main(argv = process.argv.slice(2), context = {}) {
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

    const plan = buildTccResetPlan(args);
    if (args.dryRun) {
      printDryRun(plan, stdout);
      return 0;
    }

    for (const item of plan.stopProcessCommands) {
      runCommandOrThrow(item.command, item.args, {
        optional: item.optional,
        runCommand,
      });
    }

    for (const item of plan.resetCommands) {
      runCommandOrThrow(item.command, item.args, { runCommand });
    }

    stdout.write(`Reset canonical Soto TCC permissions for ${plan.bundleId}: ${plan.services.join(", ")}\n`);
    stdout.write("If old SotoMac rows remain in System Settings, remove them there before retesting.\n");
    return 0;
  } catch (error) {
    stderr.write(`Canonical TCC reset failed: ${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
