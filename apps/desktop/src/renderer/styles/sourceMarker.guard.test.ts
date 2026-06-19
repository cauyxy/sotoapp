import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const filters = readFileSync(join(HERE, "filters.css"), "utf8");

function ruleBlock(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`selector not found: ${selector}`);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`unterminated selector: ${selector}`);
}

describe("source marker colour is unified app-wide (manual = accent, auto = neutral)", () => {
  it("paints the manual marker with the accent", () => {
    expect(ruleBlock(filters, ".word-mark-manual")).toMatch(/var\(--soto-accent\)/);
  });

  it("does not paint the auto marker with the accent", () => {
    expect(ruleBlock(filters, ".word-mark-auto")).not.toMatch(/var\(--soto-accent\)/);
  });

  it("paints the auto marker with the neutral dot colour", () => {
    expect(ruleBlock(filters, ".word-mark-auto")).toMatch(/var\(--soto-dot-neutral\)/);
  });
});
