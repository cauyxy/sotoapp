import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RENDERER_ROOT = join(HERE, "..");
const read = (file: string): string => readFileSync(join(HERE, file), "utf8");

function cssFiles(): string[] {
  return readdirSync(RENDERER_ROOT, { recursive: true, encoding: "utf8" })
    .filter((path): path is string => typeof path === "string" && path.endsWith(".css"))
    .map((path) => join(RENDERER_ROOT, path));
}

function ruleBlock(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`selector not found: ${selector}`);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    const char = css[i];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`unterminated selector: ${selector}`);
}

function mediaBlocks(css: string): string[] {
  const blocks: string[] = [];
  let searchFrom = 0;
  while (searchFrom < css.length) {
    const start = css.indexOf("@media", searchFrom);
    if (start === -1) break;
    const open = css.indexOf("{", start);
    let depth = 0;
    for (let i = open; i < css.length; i += 1) {
      const char = css[i];
      if (char === "{") depth += 1;
      if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          blocks.push(css.slice(open + 1, i));
          searchFrom = i + 1;
          break;
        }
      }
    }
    if (searchFrom <= start) break;
  }
  return blocks;
}

function selectorPattern(selector: string, declaration: string): RegExp {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\s*\\{[^}]*${declaration}`, "m");
}

describe("scrollbar and single-scroller layout guard", () => {
  it("does not opt page scrollers out of native overlay scrollbars", () => {
    const offenders = cssFiles()
      .filter((file) => readFileSync(file, "utf8").includes("::-webkit-scrollbar"))
      .map((file) => file.slice(RENDERER_ROOT.length + 1));

    expect(offenders).toEqual([]);
  });

  it("does not reference the deleted manual scrollbar gutter token", () => {
    const offenders = cssFiles()
      .filter((file) => readFileSync(file, "utf8").includes("--soto-page-scrollbar-gutter"))
      .map((file) => file.slice(RENDERER_ROOT.length + 1));

    expect(offenders).toEqual([]);
  });

  it("keeps list pages clipped with one declared page scroller", () => {
    expect(ruleBlock(read("history.css"), ".history-page")).toMatch(/overflow:\s*hidden/);
    expect(ruleBlock(read("dictionary.css"), ".dictionary-page")).toMatch(/overflow:\s*hidden/);

    const pageScroll = ruleBlock(read("shell.css"), ".page-scroll");
    expect(pageScroll).toMatch(/flex:\s*1 1 auto/);
    expect(pageScroll).toMatch(/min-height:\s*0/);
    expect(pageScroll).toMatch(/overflow-y:\s*auto/);
    expect(pageScroll).toMatch(/scrollbar-gutter:\s*stable/);
  });

  it("does not let responsive media rules break the definite-height shell chain", () => {
    for (const file of cssFiles()) {
      for (const block of mediaBlocks(readFileSync(file, "utf8"))) {
        for (const selector of [".page", ".app-shell", ".app-shell-content", ".app-shell-pane"]) {
          expect(block, file).not.toMatch(selectorPattern(selector, "overflow:\\s*visible"));
          expect(block, file).not.toMatch(selectorPattern(selector, "height:\\s*auto"));
        }
      }
    }
  });

  it("keeps Home and Modes on the flow-page no-inner-scroller contract", () => {
    const home = read("home.css");
    expect(ruleBlock(home, ".recent-card")).not.toMatch(/flex:\s*1 1 auto/);
    expect(ruleBlock(home, ".recent-card")).not.toMatch(/overflow:\s*hidden/);
    expect(home).not.toMatch(/\.recent-card \.row-list\s*\{[^}]*overflow/);

    const promptBody = ruleBlock(read("modes.css"), ".prompt-editor-body");
    expect(promptBody).toMatch(/overflow:\s*hidden/);
    expect(promptBody).not.toMatch(/flex:\s*1/);
  });

  it("renders popover panels as fixed shell overlays", () => {
    const panel = ruleBlock(read("popovers.css"), ".popover-panel");
    expect(panel).toMatch(/position:\s*fixed/);
    expect(panel).toMatch(/overflow-y:\s*auto/);
    expect(panel).not.toMatch(/top:\s*calc/);
  });
});
