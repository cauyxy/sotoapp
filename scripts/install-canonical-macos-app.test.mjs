import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import {
  buildCanonicalInstallPlan,
  parseCliArgs,
} from "./install-canonical-macos-app.mjs";

test("builds the canonical install plan from a signed macOS app bundle", () => {
  const plan = buildCanonicalInstallPlan({
    repoRoot: "/repo/sotoapp",
    args: parseCliArgs([]),
  });

  assert.deepEqual(plan.buildCommand, {
    command: "pnpm",
    args: ["build:mac:signed"],
  });
  assert.equal(plan.sourceAppPath, join("/repo/sotoapp", "target", "release", "bundle", "macos", "Soto.app"));
  assert.equal(plan.destinationAppPath, "/Applications/Soto.app");
  assert.equal(plan.expectedBundleId, "org.sotoapp.sotoapp");
  assert.equal(plan.requireDeveloperId, true);
  assert.deepEqual(plan.requiredEntitlements, ["com.apple.security.device.audio-input"]);
});

test("parses canonical install flags without changing the default identity", () => {
  const args = parseCliArgs([
    "--dry-run",
    "--skip-build",
    "--source",
    "target/release/bundle/macos/Soto.app",
    "--destination",
    "/tmp/Soto.app",
  ]);

  assert.deepEqual(args, {
    destination: "/tmp/Soto.app",
    dryRun: true,
    expectedBundleId: "org.sotoapp.sotoapp",
    help: false,
    requireDeveloperId: true,
    skipBuild: true,
    source: "target/release/bundle/macos/Soto.app",
  });
});
