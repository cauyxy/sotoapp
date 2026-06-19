#!/usr/bin/env node

import { readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Re-seeded after the Phase-D code-split (minify + per-page/locale chunks).
// Modest headroom over measured sizes so the gate actually fences each entry.
const BUDGETS = {
  "context-": 200_000,
  "index-": 70_000,
  "capsule-": 45_000,
  "selectionAction-": 20_000,
};

export function main(argv = process.argv.slice(2), context = {}) {
  void argv;
  const repoRoot = context.repoRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const assetsDir = context.assetsDir ?? join(repoRoot, "apps/desktop/out/renderer/assets");
  const readdir = context.readdir ?? ((dir) => readdirSync(dir));
  const statSize = context.statSize ?? ((path) => statSync(path).size);
  const stdout = context.stdout ?? process.stdout;
  const stderr = context.stderr ?? process.stderr;

  try {
    const jsFiles = readdir(assetsDir).filter((name) => name.endsWith(".js"));
    if (jsFiles.length === 0) {
      throw new Error(`no built renderer assets in ${assetsDir} - run the build first`);
    }
    const offenders = [];
    for (const name of jsFiles) {
      const prefix = Object.keys(BUDGETS).find((p) => name.startsWith(p));
      if (prefix === undefined) continue;
      const size = statSize(join(assetsDir, name));
      if (size > BUDGETS[prefix]) {
        offenders.push(`${name} ${size}B > ${BUDGETS[prefix]}B`);
      }
    }
    if (offenders.length > 0) {
      throw new Error(`bundle over budget:\n  ${offenders.join("\n  ")}`);
    }
    stdout.write(`renderer bundle within budget (${jsFiles.length} chunks)\n`);
    return 0;
  } catch (error) {
    stderr.write(`bundle-budget check failed: ${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
