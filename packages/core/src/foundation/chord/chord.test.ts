import { describe, expect, it } from "vitest";
import { parseChord, serializeChord, validateDisjoint } from "./chord.js";

describe("parseChord", () => {
  it("parses a single modifier", () => {
    expect(parseChord("RightMeta")).toEqual(["RightMeta"]);
  });

  it("returns modifiers in canonical order regardless of input order", () => {
    expect(parseChord("LeftShift+LeftCtrl")).toEqual(["LeftCtrl", "LeftShift"]);
  });

  it("throws on an empty string", () => {
    expect(() => parseChord("")).toThrow();
  });

  it("throws on an empty segment", () => {
    expect(() => parseChord("LeftCtrl+")).toThrow();
  });

  it("throws on an unknown component", () => {
    expect(() => parseChord("LeftCtrl+Bogus")).toThrow();
  });

  it("throws on a duplicate component", () => {
    expect(() => parseChord("LeftCtrl+LeftCtrl")).toThrow();
  });
});

describe("serializeChord", () => {
  it("serializes in canonical order, not input order", () => {
    expect(serializeChord(["LeftShift", "LeftCtrl"])).toBe("LeftCtrl+LeftShift");
  });

  it("round-trips with parseChord", () => {
    expect(serializeChord(parseChord("Fn+RightAlt"))).toBe("RightAlt+Fn");
  });
});

describe("validateDisjoint", () => {
  it("returns null when all chords are disjoint", () => {
    expect(validateDisjoint(["LeftCtrl", "RightAlt+LeftShift"])).toBeNull();
  });

  it("reports the first overlapping pair with the shared modifiers", () => {
    expect(
      validateDisjoint(["LeftCtrl+LeftShift", "LeftShift+RightAlt"]),
    ).toEqual({
      firstIndex: 0,
      secondIndex: 1,
      sharedModifiers: ["LeftShift"],
    });
  });
});
