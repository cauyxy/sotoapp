import assert from "node:assert/strict";
import { test } from "node:test";
import { main } from "./check-renderer-bundle-budget.mjs";

const sink = () => ({ write() {} });

test("passes when all entries are under budget", () => {
  const code = main([], {
    readdir: () => ["index-a.js", "context-b.js", "capsule-c.js", "selectionAction-d.js"],
    statSize: () => 1000,
    stdout: sink(),
    stderr: sink(),
  });

  assert.equal(code, 0);
});

test("fails when an entry exceeds its budget", () => {
  const code = main([], {
    readdir: () => ["index-a.js"],
    statSize: () => 999_999_999,
    stdout: sink(),
    stderr: sink(),
  });

  assert.equal(code, 1);
});
