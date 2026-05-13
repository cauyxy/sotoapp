import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("./generate-latest-json.mjs", import.meta.url));

function createFixture() {
  const repoRoot = mkdtempSync(join(tmpdir(), "soto-latest-json-"));
  mkdirSync(join(repoRoot, "artifacts-darwin"));
  mkdirSync(join(repoRoot, "artifacts-windows"));
  writeFileSync(
    join(repoRoot, "artifacts-darwin", "Soto_0.1.0_darwin_aarch64.app.tar.gz.sig"),
    "fakesig-darwin\n"
  );
  writeFileSync(
    join(repoRoot, "artifacts-windows", "Soto_0.1.0_windows_x86_64-setup.exe.sig"),
    "fakesig-windows\n"
  );
  return {
    repoRoot,
    cleanup: () => rmSync(repoRoot, { recursive: true, force: true })
  };
}

test("generates latest.json for darwin and windows updater artifacts", () => {
  const fixture = createFixture();
  try {
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: fixture.repoRoot,
      env: { ...process.env, VERSION: "0.1.0" },
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(join(fixture.repoRoot, "latest.json")), true);

    const latest = JSON.parse(readFileSync(join(fixture.repoRoot, "latest.json"), "utf8"));
    assert.equal(latest.version, "0.1.0");
    assert.equal(latest.notes, "Soto 0.1.0");
    assert.equal(typeof latest.pub_date, "string");
    assert.equal(
      latest.platforms["darwin-aarch64"].url,
      "https://soto-installer.sotoapp.org/artifacts/0.1.0/darwin-aarch64/Soto_0.1.0_darwin_aarch64.app.tar.gz"
    );
    assert.equal(latest.platforms["darwin-aarch64"].signature, "fakesig-darwin");
    assert.equal(
      latest.platforms["windows-x86_64"].url,
      "https://soto-installer.sotoapp.org/artifacts/0.1.0/windows-x86_64/Soto_0.1.0_windows_x86_64-setup.exe"
    );
    assert.equal(latest.platforms["windows-x86_64"].signature, "fakesig-windows");
  } finally {
    fixture.cleanup();
  }
});
