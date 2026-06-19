import { describe, expect, it } from "vitest";

import {
  isModifierSegment,
  keyTokenForSegment,
  prettyChord,
  prettyModifier,
} from "./modifierDisplay";

describe("modifier display helpers", () => {
  it("renders known modifiers through one exhaustively typed display table", () => {
    expect(prettyModifier("LeftAlt")).toBe("Left Alt");
    expect(keyTokenForSegment("LeftMeta")).toEqual({ label: "⌘", side: "L" });
    expect(keyTokenForSegment("Fn")).toEqual({ label: "Fn", side: null });
    expect(isModifierSegment("RightShift")).toBe(true);
  });

  it("passes unknown chord segments through unchanged", () => {
    expect(keyTokenForSegment("KeyK")).toEqual({ label: "KeyK", side: null });
    expect(isModifierSegment("KeyK")).toBe(false);
  });

  it("pretty-prints known modifiers in canonical order before unknown segments", () => {
    expect(prettyChord("RightShift+LeftAlt+KeyK")).toBe(
      "Left Alt + Right Shift + KeyK",
    );
    expect(prettyChord("")).toBe("");
  });

  it("renders macOS glyph keycaps by default and on os=mac", () => {
    expect(keyTokenForSegment("LeftCtrl", "mac")).toEqual({ label: "⌃", side: "L" });
    expect(keyTokenForSegment("RightAlt", "mac")).toEqual({ label: "⌥", side: "R" });
    expect(keyTokenForSegment("LeftMeta", "mac")).toEqual({ label: "⌘", side: "L" });
  });

  it("renders Windows word keycaps on os=win (⌥→Alt, ⌘→Win)", () => {
    expect(keyTokenForSegment("LeftCtrl", "win")).toEqual({ label: "Ctrl", side: "L" });
    expect(keyTokenForSegment("RightAlt", "win")).toEqual({ label: "Alt", side: "R" });
    expect(keyTokenForSegment("LeftShift", "win")).toEqual({ label: "Shift", side: "L" });
    expect(keyTokenForSegment("LeftMeta", "win")).toEqual({ label: "Win", side: "L" });
  });

  it("pretty-prints per-OS names for Alt and Meta", () => {
    expect(prettyModifier("LeftMeta", "mac")).toBe("Left Command");
    expect(prettyModifier("LeftMeta", "win")).toBe("Left Win");
    expect(prettyModifier("LeftAlt", "mac")).toBe("Left Option");
    expect(prettyModifier("LeftAlt", "win")).toBe("Left Alt");
    expect(prettyChord("LeftMeta+LeftShift", "win")).toBe("Left Shift + Left Win");
  });
});
