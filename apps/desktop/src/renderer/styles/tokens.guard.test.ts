import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RENDERER_ROOT = join(HERE, "..");
const TOKENS = join(HERE, "tokens.css");

function cssFiles(): string[] {
  return readdirSync(RENDERER_ROOT, { recursive: true, encoding: "utf8" })
    .filter((p): p is string => typeof p === "string" && p.endsWith(".css"))
    .map((p) => join(RENDERER_ROOT, p));
}

type Rgba = { r: number; g: number; b: number; a: number };

function parseColor(v: string): Rgba {
  const hex = v.trim().match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const value = hex[1];
    if (value === undefined) throw new Error(`unparseable color: ${v}`);
    const n = parseInt(value, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const rgba = v.trim().match(/^rgba?\(([^)]+)\)$/i);
  if (rgba) {
    const value = rgba[1];
    if (value === undefined) throw new Error(`unparseable color: ${v}`);
    const [r, g, b, a = 1] = value.split(",").map((s) => parseFloat(s.trim()));
    if (r === undefined || g === undefined || b === undefined) {
      throw new Error(`unparseable color: ${v}`);
    }
    return { r, g, b, a };
  }
  throw new Error(`unparseable color: ${v}`);
}

function over(fg: Rgba, bg: Rgba): Rgba {
  const a = fg.a + bg.a * (1 - fg.a);
  const mix = (f: number, b: number) => (f * fg.a + b * bg.a * (1 - fg.a)) / a;
  return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b), a };
}

function lum({ r, g, b }: Rgba): number {
  const ch = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

function contrast(x: Rgba, y: Rgba): number {
  const hi = Math.max(lum(x), lum(y));
  const lo = Math.min(lum(x), lum(y));
  return (hi + 0.05) / (lo + 0.05);
}

function lightToken(name: string): string {
  const value = tokenValues(name)[0];
  if (value === undefined) throw new Error(`token ${name} not found`);
  return value;
}

function tokenValues(name: string): string[] {
  const matches = readFileSync(TOKENS, "utf8").matchAll(
    new RegExp(`${name}:\\s*([^;]+);`, "g"),
  );
  return [...matches].map((m) => {
    const value = m[1];
    if (value === undefined) throw new Error(`token ${name} not found`);
    return value.trim();
  });
}

describe("token guard", () => {
  it("never uses --soto-ink-mute as a text color (fills/separators only)", () => {
    const re = /(?<![-\w])color:\s*var\(--soto-ink-mute\)/;
    const offenders = cssFiles()
      .filter((f) => re.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(RENDERER_ROOT.length + 1));

    expect(offenders).toEqual([]);
  });

  it("defines the new tokens in light + both dark blocks (4-space-indent trap)", () => {
    const css = readFileSync(TOKENS, "utf8");
    for (const t of ["--soto-accent-text", "--soto-field-inset", "--soto-ink-disabled"]) {
      const count = (css.match(new RegExp(`${t}:`, "g")) ?? []).length;
      expect(count, `${t} must be defined 3x (light + dark selector + system-dark media)`).toBe(3);
    }
    expect((css.match(/--soto-focus-ring-color:/g) ?? []).length).toBe(1);
    expect(lightToken("--soto-radius-card-item")).toBe("8px");
  });

  it("keeps the dark window wash at 60 percent opacity over macOS vibrancy", () => {
    const values = tokenValues("--soto-bg-wash");

    expect(values).toEqual([
      "rgba(245, 243, 238, 0.72)",
      "rgba(22, 20, 20, 0.6)",
      "rgba(22, 20, 20, 0.6)",
      "var(--soto-bg)",
    ]);
  });

  it("routes Models item-card radii through --soto-radius-card-item", () => {
    const css = readFileSync(join(HERE, "models.css"), "utf8");

    for (const selector of [".model-config-card", ".models-add-card", ".models-vendor-tile"]) {
      const escaped = selector.replace(".", "\\.");
      expect(css).toMatch(new RegExp(`${escaped}\\s*\\{[^}]*border-radius:\\s*var\\(--soto-radius-card-item\\);`));
      expect(css).not.toMatch(new RegExp(`${escaped}\\s*\\{[^}]*border-radius:\\s*8px;`));
    }
  });

  it("keeps Modes on the card-stack layout instead of the old master-detail shell", () => {
    const css = readFileSync(join(HERE, "modes.css"), "utf8");

    expect(css).toContain(".modes-card-stack");
    expect(css).toContain("border-radius: var(--soto-radius-card-item);");
    expect(css).not.toContain(".modes-two-column");
    expect(css).not.toContain(".selection-trigger-bar");
    expect(css).not.toContain(".hotkey-badge");
  });

  it("base.css no longer ships the dead capsule-window rules", () => {
    const css = readFileSync(join(HERE, "base.css"), "utf8");

    expect(css).not.toContain("body.capsule-window");
  });
});

describe("WCAG contrast (locked against live tokens)", () => {
  it("--soto-accent-text clears AA on the accent-soft pill", () => {
    const field = parseColor(lightToken("--soto-field"));
    const pill = over(parseColor(lightToken("--soto-accent-soft")), field);
    const text = parseColor(lightToken("--soto-accent-text"));

    expect(contrast(text, pill)).toBeGreaterThanOrEqual(4.5);
  });

  it("plain --soto-accent as text on that pill FAILS AA (why accent-text exists)", () => {
    const field = parseColor(lightToken("--soto-field"));
    const pill = over(parseColor(lightToken("--soto-accent-soft")), field);

    expect(contrast(parseColor(lightToken("--soto-accent")), pill)).toBeLessThan(4.5);
  });

  it("reassigned meta text (--soto-ink-dim) clears AA-large on the card surface", () => {
    const surface = parseColor(lightToken("--soto-surface"));
    const ink = over(parseColor(lightToken("--soto-ink-dim")), surface);

    expect(contrast(ink, surface)).toBeGreaterThanOrEqual(3.0);
  });
});
