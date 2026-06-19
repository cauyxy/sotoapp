#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// `_zod` is the zod v4 internal brand (inert on the repo's v3 — kept for a
// future v4 upgrade); the other three reliably catch a v3 leak.
const ZOD_MARKERS = ["ZodError", "ZodType", "safeParse", "_zod"];

export function main(argv = process.argv.slice(2), context = {}) {
  void argv;
  const repoRoot = context.repoRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const assetsDir = context.assetsDir ?? join(repoRoot, "apps/desktop/out/renderer/assets");
  const readdir = context.readdir ?? ((dir) => readdirSync(dir));
  const readFile = context.readFile ?? ((path) => readFileSync(path, "utf8"));
  const stdout = context.stdout ?? process.stdout;
  const stderr = context.stderr ?? process.stderr;

  try {
    const jsFiles = readdir(assetsDir).filter((name) => name.endsWith(".js"));
    if (jsFiles.length === 0) {
      throw new Error(`no built renderer assets in ${assetsDir} - run the build first`);
    }
    const offenders = [];
    for (const name of jsFiles) {
      const content = readFile(join(assetsDir, name));
      if (ZOD_MARKERS.some((marker) => content.includes(marker))) {
        offenders.push(name);
      }
    }
    if (offenders.length > 0) {
      throw new Error(`zod leaked into renderer bundle(s): ${offenders.join(", ")}`);
    }
    stdout.write(`renderer bundle is zod-free (${jsFiles.length} chunks)\n`);
    return 0;
  } catch (error) {
    stderr.write(`renderer-no-zod check failed: ${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
