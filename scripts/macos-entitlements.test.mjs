import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const audioInputEntitlement = "com.apple.security.device.audio-input";

test("macOS packaging declares the hardened runtime audio input entitlement", () => {
  const config = JSON.parse(
    readFileSync(join(repoRoot, "apps", "desktop", "src-tauri", "tauri.macos.conf.json"), "utf8"),
  );

  const entitlementsPath = config.bundle?.macOS?.entitlements;
  assert.equal(typeof entitlementsPath, "string");

  const absoluteEntitlementsPath = join(repoRoot, "apps", "desktop", "src-tauri", entitlementsPath);
  assert.equal(existsSync(absoluteEntitlementsPath), true);

  const plist = readFileSync(absoluteEntitlementsPath, "utf8");
  assert.match(
    plist,
    new RegExp(`<key>${audioInputEntitlement}</key>\\s*<true\\s*/>`),
  );
});
