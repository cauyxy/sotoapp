import assert from "node:assert/strict";
import { test } from "node:test";
import { main } from "./check-renderer-no-zod.mjs";

const sink = () => ({ write() {} });

test("passes when no asset contains zod markers", () => {
  const code = main([], {
    readdir: () => ["index-abc.js", "context-def.js"],
    readFile: () => "export const x = 1;",
    stdout: sink(),
    stderr: sink(),
  });

  assert.equal(code, 0);
});

test("fails when an asset contains a zod marker", () => {
  const code = main([], {
    readdir: () => ["index-abc.js"],
    readFile: () => "class ZodError extends Error {}",
    stdout: sink(),
    stderr: sink(),
  });

  assert.equal(code, 1);
});
