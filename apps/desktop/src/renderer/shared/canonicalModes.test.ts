import { describe, expect, it } from "vitest";
import {
  CANONICAL_MODE_IDS,
  canonicalModeLabel,
  isCanonicalModeId,
} from "./canonicalModes.js";

const t = ((key: string) => key) as unknown as Parameters<typeof canonicalModeLabel>[0];

describe("canonical voice modes", () => {
  it("lists only the public voice modes", () => {
    expect([...CANONICAL_MODE_IDS]).toEqual(["default", "translate"]);
    expect(isCanonicalModeId("rewrite")).toBe(false);
  });
});

describe("canonicalModeLabel", () => {
  it("returns the i18n key for a canonical id", () => {
    expect(canonicalModeLabel(t, "default")).toBe("modes.canonical.default");
    expect(canonicalModeLabel(t, "translate")).toBe("modes.canonical.translate");
  });

  it("returns null for a custom id (caller falls back to mode.name)", () => {
    expect(canonicalModeLabel(t, "mode.abc")).toBeNull();
  });
});
