import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";

import {
  buildTauriArgs,
  loadSigningEnvironment,
  parseCliArgs,
} from "./macos-signed-build.mjs";

function createFixture() {
  const repoRoot = mkdtempSync(join(tmpdir(), "soto-mac-signing-"));
  const secretsDir = join(repoRoot, "signing-secrets");
  mkdirSync(secretsDir);
  writeFileSync(join(secretsDir, "apple-signing-identity"), "Developer ID Application: Soto Labs (TEAM123456)\n");
  writeFileSync(join(secretsDir, "apple-api-key"), "KEY1234567\r\n");
  writeFileSync(join(secretsDir, "apple-api-issuer"), "11111111-2222-3333-4444-555555555555\n");
  writeFileSync(join(secretsDir, "apple-api-key-path"), "signing-secrets/AuthKey_KEY1234567.p8\n");
  writeFileSync(join(secretsDir, "AuthKey_KEY1234567.p8"), "PRIVATE KEY PLACEHOLDER\n");
  writeFileSync(join(secretsDir, "tauri-signing-private-key"), "TAURI UPDATER KEY PLACEHOLDER\n");
  return {
    repoRoot,
    secretsDir,
    cleanup: () => rmSync(repoRoot, { recursive: true, force: true }),
  };
}

test("loads Apple signing environment without leaking newline characters", () => {
  const fixture = createFixture();
  try {
    const env = loadSigningEnvironment({
      repoRoot: fixture.repoRoot,
      secretsDir: fixture.secretsDir,
    });

    assert.equal(env.APPLE_SIGNING_IDENTITY, "Developer ID Application: Soto Labs (TEAM123456)");
    assert.equal(env.APPLE_API_KEY, "KEY1234567");
    assert.equal(env.APPLE_API_ISSUER, "11111111-2222-3333-4444-555555555555");
    assert.equal(basename(env.APPLE_API_KEY_PATH), "AuthKey_KEY1234567.p8");
  } finally {
    fixture.cleanup();
  }
});

test("builds the default signed macOS Tauri command with pass-through args", () => {
  assert.deepEqual(buildTauriArgs([]), [
    "tauri",
    "build",
    "--bundles",
    "app,dmg",
    "--ci",
  ]);

  assert.deepEqual(buildTauriArgs(["--skip-stapling"]), [
    "tauri",
    "build",
    "--bundles",
    "app,dmg",
    "--ci",
    "--skip-stapling",
  ]);
});

test("parses script flags separately from Tauri pass-through args", () => {
  assert.deepEqual(parseCliArgs(["--dry-run", "--secrets-dir", "custom-secrets", "--", "--skip-stapling"]), {
    dryRun: true,
    help: false,
    secretsDir: "custom-secrets",
    tauriArgs: ["--skip-stapling"],
  });
});
