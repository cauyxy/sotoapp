#!/usr/bin/env node
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const repoRoot = resolve(pkgRoot, "..", "..");

const targets = [
  { from: resolve(repoRoot, "images", "icon.png"), to: resolve(pkgRoot, "public", "icon.png") },
  { from: resolve(repoRoot, "images", "soto-mark.svg"), to: resolve(pkgRoot, "public", "soto-mark.svg") }
];

for (const { from, to } of targets) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  console.log(`copied ${from} -> ${to}`);
}