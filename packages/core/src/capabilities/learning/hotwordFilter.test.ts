import { describe, expect, it } from "vitest";
import { isValidHotwordCandidate } from "./hotwordFilter.js";

const none = new Set<string>();

describe("isValidHotwordCandidate", () => {
  it("accepts CJK terms", () => {
    expect(isValidHotwordCandidate("豆包", none)).toBe(true);
    expect(isValidHotwordCandidate("阿里云", none)).toBe(true);
  });

  it("rejects lowercase english (no signature) and blacklisted words", () => {
    expect(isValidHotwordCandidate("hello", none)).toBe(false);
    expect(isValidHotwordCandidate("the", none)).toBe(false);
  });

  it("accepts camelCase / uppercase / digit-bearing terms", () => {
    expect(isValidHotwordCandidate("Doubao", none)).toBe(true);
    expect(isValidHotwordCandidate("GPT4", none)).toBe(true);
    expect(isValidHotwordCandidate("vLLM", none)).toBe(true);
  });

  it("rejects terms shorter than 2 scalars (including a single CJK char)", () => {
    expect(isValidHotwordCandidate("A", none)).toBe(false);
    expect(isValidHotwordCandidate("中", none)).toBe(false);
  });

  it("rejects a term longer than 30 scalars", () => {
    expect(isValidHotwordCandidate("A".repeat(31), none)).toBe(false);
  });

  it("rejects a term already in the existing set (case-sensitive)", () => {
    expect(isValidHotwordCandidate("豆包", new Set(["豆包"]))).toBe(false);
    // case-sensitive: a different case is NOT considered existing
    expect(isValidHotwordCandidate("Doubao", new Set(["doubao"]))).toBe(true);
  });

  it("rejects the blacklist case-insensitively", () => {
    expect(isValidHotwordCandidate("The", none)).toBe(false);
    expect(isValidHotwordCandidate("的", none)).toBe(false);
  });

  it("rejects pure whitespace, punctuation, or digit strings", () => {
    expect(isValidHotwordCandidate("   ", none)).toBe(false);
    expect(isValidHotwordCandidate("...", none)).toBe(false);
    expect(isValidHotwordCandidate("12345", none)).toBe(false);
  });
});
