import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  buildUploadPlan,
  buildWranglerPutArgs,
  parseCliArgs,
  stageLocalArtifacts,
} from "./publish-updater-r2.mjs";

function createFixture() {
  const repoRoot = mkdtempSync(join(tmpdir(), "soto-publish-r2-"));
  return {
    repoRoot,
    cleanup: () => rmSync(repoRoot, { recursive: true, force: true }),
  };
}

test("stages local Tauri updater artifacts with version-first platform names", () => {
  const fixture = createFixture();
  try {
    mkdirSync(join(fixture.repoRoot, "target", "release", "bundle", "macos"), { recursive: true });
    mkdirSync(join(fixture.repoRoot, "target", "release", "bundle", "dmg"), { recursive: true });
    mkdirSync(join(fixture.repoRoot, "target", "release", "bundle", "nsis"), { recursive: true });
    writeFileSync(join(fixture.repoRoot, "target", "release", "bundle", "macos", "Soto.app.tar.gz"), "mac tar");
    writeFileSync(join(fixture.repoRoot, "target", "release", "bundle", "macos", "Soto.app.tar.gz.sig"), "mac sig");
    writeFileSync(join(fixture.repoRoot, "target", "release", "bundle", "dmg", "Soto_0.1.0_aarch64.dmg"), "dmg");
    writeFileSync(
      join(fixture.repoRoot, "target", "release", "bundle", "nsis", "Soto_0.0.9_x64-setup.exe"),
      "old exe"
    );
    writeFileSync(
      join(fixture.repoRoot, "target", "release", "bundle", "nsis", "Soto_0.0.9_x64-setup.exe.sig"),
      "old exe sig"
    );
    writeFileSync(
      join(fixture.repoRoot, "target", "release", "bundle", "nsis", "Soto_0.1.0_x64-setup.exe"),
      "exe"
    );
    writeFileSync(
      join(fixture.repoRoot, "target", "release", "bundle", "nsis", "Soto_0.1.0_x64-setup.exe.sig"),
      "exe sig"
    );

    const staged = stageLocalArtifacts({ repoRoot: fixture.repoRoot, version: "0.1.0" });

    assert.deepEqual(
      staged.map((artifact) => artifact.key),
      [
        "artifacts/0.1.0/darwin-aarch64/Soto_0.1.0_darwin_aarch64.app.tar.gz",
        "artifacts/0.1.0/darwin-aarch64/Soto_0.1.0_darwin_aarch64.app.tar.gz.sig",
        "artifacts/0.1.0/darwin-aarch64/Soto_0.1.0_darwin_aarch64.dmg",
        "artifacts/0.1.0/windows-x86_64/Soto_0.1.0_windows_x86_64-setup.exe",
        "artifacts/0.1.0/windows-x86_64/Soto_0.1.0_windows_x86_64-setup.exe.sig",
      ]
    );
    assert.equal(existsSync(join(fixture.repoRoot, "artifacts-darwin", "Soto_0.1.0_darwin_aarch64.app.tar.gz")), true);
    assert.equal(existsSync(join(fixture.repoRoot, "artifacts-windows", "Soto_0.1.0_windows_x86_64-setup.exe")), true);
    assert.equal(readFileSync(join(fixture.repoRoot, "artifacts-windows", "Soto_0.1.0_windows_x86_64-setup.exe"), "utf8"), "exe");
  } finally {
    fixture.cleanup();
  }
});

test("builds a complete R2 upload plan rooted by version and platform", () => {
  const fixture = createFixture();
  try {
    mkdirSync(join(fixture.repoRoot, "artifacts-darwin"));
    mkdirSync(join(fixture.repoRoot, "artifacts-windows"));
    writeFileSync(join(fixture.repoRoot, "artifacts-darwin", "Soto_0.1.0_darwin_aarch64.app.tar.gz"), "mac tar");
    writeFileSync(join(fixture.repoRoot, "artifacts-darwin", "Soto_0.1.0_darwin_aarch64.app.tar.gz.sig"), "mac sig");
    writeFileSync(join(fixture.repoRoot, "artifacts-darwin", "Soto_0.1.0_darwin_aarch64.dmg"), "dmg");
    writeFileSync(join(fixture.repoRoot, "artifacts-windows", "Soto_0.1.0_windows_x86_64-setup.exe"), "exe");
    writeFileSync(join(fixture.repoRoot, "artifacts-windows", "Soto_0.1.0_windows_x86_64-setup.exe.sig"), "exe sig");
    writeFileSync(join(fixture.repoRoot, "latest.json"), "{}");

    const plan = buildUploadPlan({ repoRoot: fixture.repoRoot, version: "0.1.0" });

    assert.deepEqual(
      plan.map((item) => [item.key, item.contentType]),
      [
        ["artifacts/0.1.0/darwin-aarch64/Soto_0.1.0_darwin_aarch64.app.tar.gz", "application/gzip"],
        ["artifacts/0.1.0/darwin-aarch64/Soto_0.1.0_darwin_aarch64.app.tar.gz.sig", "text/plain; charset=utf-8"],
        ["artifacts/0.1.0/darwin-aarch64/Soto_0.1.0_darwin_aarch64.dmg", "application/octet-stream"],
        ["artifacts/0.1.0/windows-x86_64/Soto_0.1.0_windows_x86_64-setup.exe", "application/octet-stream"],
        ["artifacts/0.1.0/windows-x86_64/Soto_0.1.0_windows_x86_64-setup.exe.sig", "text/plain; charset=utf-8"],
        ["latest.json", "application/json; charset=utf-8"],
      ]
    );
  } finally {
    fixture.cleanup();
  }
});

test("builds wrangler put arguments without uploading during dry runs", () => {
  const args = buildWranglerPutArgs({
    bucket: "soto-installer",
    item: {
      path: "/tmp/latest.json",
      key: "latest.json",
      contentType: "application/json; charset=utf-8",
    },
  });

  assert.deepEqual(args, [
    "wrangler",
    "r2",
    "object",
    "put",
    "soto-installer/latest.json",
    "--file",
    "/tmp/latest.json",
    "--content-type",
    "application/json; charset=utf-8",
    "--remote",
  ]);
});

test("parses local publish flags", () => {
  assert.deepEqual(parseCliArgs(["--version", "0.1.0", "--bucket", "custom-bucket", "--dry-run", "--skip-stage"]), {
    allowPartial: false,
    bucket: "custom-bucket",
    dryRun: true,
    help: false,
    skipStage: true,
    version: "0.1.0",
    wranglerBin: "wrangler",
  });
});
