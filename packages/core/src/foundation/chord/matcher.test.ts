import { describe, expect, it } from "vitest";
import { ChordMatcher } from "./matcher.js";

describe("ChordMatcher", () => {
  it("emits pressed (pass_through) when a single-modifier chord's key goes down", () => {
    const matcher = new ChordMatcher();
    matcher.replaceChords(["RightMeta"]);

    const outcome = matcher.feed({ code: "MetaRight", down: true });

    expect(outcome).toEqual({
      events: [{ type: "pressed", chordIndex: 0 }],
      swallow: "pass_through",
    });
  });

  it("emits released when a held chord's key goes up", () => {
    const matcher = new ChordMatcher();
    matcher.replaceChords(["RightMeta"]);
    matcher.feed({ code: "MetaRight", down: true });

    const outcome = matcher.feed({ code: "MetaRight", down: false });

    expect(outcome).toEqual({
      events: [{ type: "released", chordIndex: 0 }],
      swallow: "pass_through",
    });
  });

  it("emits nothing on the second down of an already-active chord (no re-press)", () => {
    const matcher = new ChordMatcher();
    matcher.replaceChords(["RightMeta"]);
    matcher.feed({ code: "MetaRight", down: true });

    const outcome = matcher.feed({ code: "MetaRight", down: true });

    expect(outcome.events).toEqual([]);
  });

  it("a multi-modifier chord only fires once every member is held", () => {
    const matcher = new ChordMatcher();
    matcher.replaceChords(["LeftCtrl+LeftShift"]);

    expect(matcher.feed({ code: "ControlLeft", down: true }).events).toEqual([]);
    expect(matcher.feed({ code: "ShiftLeft", down: true }).events).toEqual([
      { type: "pressed", chordIndex: 0 },
    ]);
  });

  it("releasing one member of an active combo emits released", () => {
    const matcher = new ChordMatcher();
    matcher.replaceChords(["LeftCtrl+LeftShift"]);
    matcher.feed({ code: "ControlLeft", down: true });
    matcher.feed({ code: "ShiftLeft", down: true });

    const outcome = matcher.feed({ code: "ControlLeft", down: false });

    expect(outcome.events).toEqual([{ type: "released", chordIndex: 0 }]);
  });

  it("an incidental unrelated modifier does not toggle an active chord", () => {
    const matcher = new ChordMatcher();
    matcher.replaceChords(["RightAlt"]);
    matcher.feed({ code: "AltRight", down: true });

    const outcome = matcher.feed({ code: "ShiftLeft", down: true });

    expect(outcome.events).toEqual([]);
  });

  it("tracks multiple chords independently by index", () => {
    const matcher = new ChordMatcher();
    matcher.replaceChords(["RightMeta", "RightShift"]);

    expect(matcher.feed({ code: "MetaRight", down: true }).events).toEqual([
      { type: "pressed", chordIndex: 0 },
    ]);
    expect(matcher.feed({ code: "ShiftRight", down: true }).events).toEqual([
      { type: "pressed", chordIndex: 1 },
    ]);
    expect(matcher.feed({ code: "ShiftRight", down: false }).events).toEqual([
      { type: "released", chordIndex: 1 },
    ]);
  });

  it("replaceChords releases any currently-active chord", () => {
    const matcher = new ChordMatcher();
    matcher.replaceChords(["RightAlt"]);
    matcher.feed({ code: "AltRight", down: true });

    const released = matcher.replaceChords([]);

    expect(released).toEqual([{ type: "released", chordIndex: 0 }]);
  });

  it("replaceChords clears held modifiers so a stale held key can't fire a newly registered chord", () => {
    const matcher = new ChordMatcher();
    matcher.feed({ code: "ControlLeft", down: true }); // held before registration
    matcher.replaceChords(["LeftCtrl+LeftShift"]);

    // Only Shift goes down now; the stale Ctrl must NOT count toward the combo.
    const outcome = matcher.feed({ code: "ShiftLeft", down: true });

    expect(outcome.events).toEqual([]);
  });

  it("releasing a modifier that was cleared by replaceChords is a no-op", () => {
    const matcher = new ChordMatcher();
    matcher.feed({ code: "ControlLeft", down: true });
    matcher.replaceChords(["LeftCtrl+LeftShift"]);

    const outcome = matcher.feed({ code: "ControlLeft", down: false });

    expect(outcome.events).toEqual([]);
  });

  it("clearHeld releases active chords and drops held state", () => {
    const matcher = new ChordMatcher();
    matcher.replaceChords(["RightAlt"]);
    matcher.feed({ code: "AltRight", down: true });

    const released = matcher.clearHeld();

    expect(released).toEqual([{ type: "released", chordIndex: 0 }]);
  });
});
