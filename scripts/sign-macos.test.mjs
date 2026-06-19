import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";

import {
  buildElectronBuilderArgs,
  loadSigningEnvironment,
  parseCliArgs,
  verifySignedBundle,
} from "./sign-macos.mjs";

function createSigningFixture() {
  const repoRoot = mkdtempSync(join(tmpdir(), "soto-electron-signing-"));
  const secretsDir = join(repoRoot, "signing-secrets");
  mkdirSync(secretsDir);
  writeFileSync(join(secretsDir, "apple-signing-identity"), "Developer ID Application: Soto Labs (TEAM123456)\n");
  writeFileSync(join(secretsDir, "apple-api-key"), "KEY1234567\r\n");
  writeFileSync(join(secretsDir, "apple-api-issuer"), "11111111-2222-3333-4444-555555555555\n");
  writeFileSync(join(secretsDir, "apple-api-key-path"), "signing-secrets/AuthKey_KEY1234567.p8\n");
  writeFileSync(join(secretsDir, "AuthKey_KEY1234567.p8"), "PRIVATE KEY PLACEHOLDER\n");
  return {
    repoRoot,
    secretsDir,
    cleanup: () => rmSync(repoRoot, { recursive: true, force: true }),
  };
}

test("loads Electron signing and notarization environment from signing-secrets", () => {
  const fixture = createSigningFixture();
  try {
    const env = loadSigningEnvironment({
      repoRoot: fixture.repoRoot,
      secretsDir: fixture.secretsDir,
    });

    assert.equal(env.CSC_NAME, "Soto Labs (TEAM123456)");
    assert.equal(env.APPLE_API_KEY_ID, "KEY1234567");
    assert.equal(env.APPLE_API_ISSUER, "11111111-2222-3333-4444-555555555555");
    assert.equal(basename(env.APPLE_API_KEY), "AuthKey_KEY1234567.p8");
  } finally {
    fixture.cleanup();
  }
});

test("normalizes prefixed signing identities from the environment", () => {
  const fixture = createSigningFixture();
  try {
    const env = loadSigningEnvironment({
      repoRoot: fixture.repoRoot,
      secretsDir: fixture.secretsDir,
      env: {
        CSC_NAME: "Developer ID Application: Soto Labs (TEAM123456)",
      },
    });

    assert.equal(env.CSC_NAME, "Soto Labs (TEAM123456)");
  } finally {
    fixture.cleanup();
  }
});

test("builds the signed Electron Builder command with pass-through args", () => {
  assert.deepEqual(
    buildElectronBuilderArgs({
      arch: "arm64",
      electronBuilderArgs: ["-c.extraMetadata.version=0.2.0"],
    }),
    [
      "--filter",
      "@soto/desktop",
      "exec",
      "electron-builder",
      "--mac",
      "--arm64",
      "--publish",
      "never",
      "-c.forceCodeSigning=true",
      "-c.extraMetadata.version=0.2.0",
    ],
  );
});

test("verifies signed Electron bundle, native resource, and updater feed", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "soto-electron-verify-"));
  const bundlePath = join(repoRoot, "apps/desktop/dist/mac-arm64/Soto.app");
  mkdirSync(join(bundlePath, "Contents/Resources/native"), { recursive: true });
  writeFileSync(join(bundlePath, "Contents/Resources/native/libSotoMacNative.dylib"), "dylib");
  writeFileSync(join(repoRoot, "apps/desktop/dist/latest-mac.yml"), "version: 0.1.0\n");
  try {
    const verified = verifySignedBundle({
      repoRoot,
      runCommand: () => ({ status: 0, stdout: "", stderr: "" }),
    });

    assert.equal(verified, bundlePath);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("verifySignedBundle errors when the macOS native dylib was not packaged", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "soto-electron-verify-missing-native-"));
  const bundlePath = join(repoRoot, "apps/desktop/dist/mac-arm64/Soto.app");
  mkdirSync(bundlePath, { recursive: true });
  writeFileSync(join(repoRoot, "apps/desktop/dist/latest-mac.yml"), "version: 0.1.0\n");
  try {
    assert.throws(
      () => verifySignedBundle({ repoRoot, runCommand: () => ({ status: 0 }) }),
      /Packaged native dylib not found/,
    );
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("parses script flags separately from Electron Builder pass-through args", () => {
  assert.deepEqual(parseCliArgs(["--dry-run", "--secrets-dir", "custom-secrets", "--arch", "arm64", "--", "--dir"]), {
    arch: "arm64",
    dryRun: true,
    help: false,
    secretsDir: "custom-secrets",
    skipNative: false,
    skipVerify: false,
    electronBuilderArgs: ["--dir"],
  });
});
