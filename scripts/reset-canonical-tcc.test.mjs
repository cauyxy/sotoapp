import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildTccResetPlan,
  parseCliArgs,
} from "./reset-canonical-tcc.mjs";

test("builds a TCC reset plan for Soto's canonical macOS permissions", () => {
  const plan = buildTccResetPlan(parseCliArgs([]));

  assert.equal(plan.bundleId, "org.sotoapp.sotoapp");
  assert.deepEqual(plan.services, ["Microphone", "Accessibility"]);
  assert.deepEqual(
    plan.resetCommands.map((item) => [item.command, item.args]),
    [
      ["tccutil", ["reset", "Microphone", "org.sotoapp.sotoapp"]],
      ["tccutil", ["reset", "Accessibility", "org.sotoapp.sotoapp"]],
    ],
  );
});

test("parses TCC reset flags while keeping the canonical services fixed", () => {
  assert.deepEqual(parseCliArgs(["--dry-run", "--bundle-id", "org.example.Soto"]), {
    bundleId: "org.example.Soto",
    dryRun: true,
    help: false,
  });
});
