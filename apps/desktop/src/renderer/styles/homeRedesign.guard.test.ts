import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(join(HERE, file), "utf8");

describe("home redesign — instrument inlay removed", () => {
  it("home.css drops the black inlay surface and its parts", () => {
    const css = read("home.css");
    expect(css).not.toContain(".home-inlay");
    expect(css).not.toContain(".home-capsule-replica");
    expect(css).not.toContain(".home-replica-bar");
    expect(css).not.toContain("homeReplicaIdle");
    expect(css).not.toContain(".home-mode-chip");
    expect(css).not.toContain(".home-status-stats");
    expect(css).not.toContain("--soto-inlay-surface");
  });

  it("home.css ships the promoted stat strip", () => {
    const css = read("home.css");
    expect(css).toContain(".home-stats");
    expect(css).toContain(".home-stat-value");
    expect(css).toContain(".home-stat-label");
  });

  it("tokens.css defines the stat number size", () => {
    expect(read("tokens.css")).toMatch(
      /--soto-text-title:\s*calc\(15px \* var\(--soto-text-scale\)\);\s*--soto-text-stat:\s*calc\(24px \* var\(--soto-text-scale\)\);/,
    );
  });

  it("removes the orphaned inlay primitive + tokens, keeps hotkey-badge tokens", () => {
    const primitives = read("primitives.css");
    const tokens = read("tokens.css");
    const hotkeyBadge = primitives.match(/\.hotkey-badge\s*\{[\s\S]*?\}/)?.[0] ?? "";
    expect(primitives).not.toMatch(/\.inlay\s*\{/);
    expect(tokens).not.toContain("--soto-shadow-inlay");
    expect(tokens).not.toContain("--soto-inlay-ink-soft");
    expect(tokens).toMatch(/--soto-inlay-surface\s*:/);
    expect(tokens).toMatch(/--soto-inlay-rule\s*:/);
    expect(tokens).toMatch(/--soto-inlay-ink\s*:/);
    expect(hotkeyBadge).toMatch(/var\(--soto-inlay-surface\)/);
    expect(hotkeyBadge).toMatch(/var\(--soto-inlay-rule\)/);
    expect(hotkeyBadge).toMatch(/var\(--soto-inlay-ink\)/);
  });

  it("drops home-replica-bar from reduced-motion and swaps the CJK stat label", () => {
    expect(read("toast-misc.css")).not.toContain(".home-replica-bar");
    const base = read("base.css");
    expect(base).not.toContain(".home-status-stats");
    expect(base).toContain(".home-stat-label");
  });
});
