import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const STYLES = join(HERE, "..", "..", "..", "styles");
const read = (f: string): string => readFileSync(join(STYLES, f), "utf8");

describe("settings icon-list layout guard", () => {
  it("forms.css gives every row an accent icon tile", () => {
    const css = read("forms.css");
    expect(css).toContain(".setting-row-tile");
    expect(css).toMatch(/\.setting-row-tile\s*\{[^}]*background:\s*var\(--soto-accent-soft\)/);
    expect(css).toMatch(/\.setting-row-tile\s*\{[^}]*color:\s*var\(--soto-accent-text\)/);
  });

  it("forms.css routes the control column through one shared width token", () => {
    const css = read("forms.css");
    expect(css).toMatch(/\.setting-row-control\s*\{[^}]*flex:\s*0 0 var\(--soto-setting-control-w/);
  });

  it("forms.css drops the per-panel select width + full-bleed segmented", () => {
    const css = read("forms.css");
    expect(css).not.toContain(".setting-row-select");
    expect(css).not.toMatch(/\.setting-row \.segmented\s*\{[^}]*width:\s*100%/);
  });

  it("settings-stats.css caps content width and defines the control token", () => {
    const css = read("settings-stats.css");
    expect(css).toMatch(/\.settings-flow-content\s*\{[^}]*max-width:/);
    expect(css).toContain("--soto-setting-control-w:");
  });
});
