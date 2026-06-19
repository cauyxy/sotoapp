import { describe, expect, it } from "vitest";

import { createCaptureMachine } from "./captureMachine";

describe("createCaptureMachine", () => {
  it("captures a single modifier only after it is released", () => {
    const machine = createCaptureMachine();

    expect(
      machine.feed({ kind: "modifier", modifier: "RightCtrl", down: true }),
    ).toBeNull();
    expect(machine.getSnapshot()).toMatchObject({
      phase: "holding",
      chord: "RightCtrl",
      typingWarning: false,
    });

    expect(
      machine.feed({ kind: "modifier", modifier: "RightCtrl", down: false }),
    ).toBeNull();
    expect(machine.getSnapshot()).toMatchObject({
      phase: "captured",
      chord: "RightCtrl",
      typingWarning: false,
    });
  });

  it("captures a two-modifier combo in canonical order for either release order", () => {
    const first = createCaptureMachine();
    first.feed({ kind: "modifier", modifier: "RightShift", down: true });
    first.feed({ kind: "modifier", modifier: "RightCtrl", down: true });
    first.feed({ kind: "modifier", modifier: "RightShift", down: false });
    first.feed({ kind: "modifier", modifier: "RightCtrl", down: false });

    const second = createCaptureMachine();
    second.feed({ kind: "modifier", modifier: "RightShift", down: true });
    second.feed({ kind: "modifier", modifier: "RightCtrl", down: true });
    second.feed({ kind: "modifier", modifier: "RightCtrl", down: false });
    second.feed({ kind: "modifier", modifier: "RightShift", down: false });

    expect(first.getSnapshot()).toMatchObject({
      phase: "captured",
      chord: "RightCtrl+RightShift",
    });
    expect(second.getSnapshot()).toMatchObject({
      phase: "captured",
      chord: "RightCtrl+RightShift",
    });
  });

  it("treats sequential taps as last press wins and never commits on release", () => {
    const machine = createCaptureMachine();
    machine.feed({ kind: "modifier", modifier: "RightCtrl", down: true });
    expect(
      machine.feed({ kind: "modifier", modifier: "RightCtrl", down: false }),
    ).toBeNull();

    machine.feed({ kind: "modifier", modifier: "RightShift", down: true });
    expect(machine.getSnapshot()).toMatchObject({
      phase: "holding",
      chord: "RightShift",
    });
    expect(
      machine.feed({ kind: "modifier", modifier: "RightShift", down: false }),
    ).toBeNull();

    expect(machine.getSnapshot()).toMatchObject({
      phase: "captured",
      chord: "RightShift",
    });
  });

  it("tracks other-key and max-two hints without changing the candidate", () => {
    const machine = createCaptureMachine();

    machine.feed({ kind: "other" });
    expect(machine.getSnapshot()).toMatchObject({
      phase: "listening",
      sawOther: true,
      hint: "onlyModifiers",
    });

    machine.feed({ kind: "modifier", modifier: "LeftCtrl", down: true });
    machine.feed({ kind: "modifier", modifier: "LeftAlt", down: true });
    machine.feed({ kind: "modifier", modifier: "LeftShift", down: true });

    expect(machine.getSnapshot()).toMatchObject({
      phase: "holding",
      chord: "LeftCtrl+LeftAlt",
      maxHint: true,
      hint: "maxTwo",
    });
  });

  it("uses explicit escape and confirm actions", () => {
    const machine = createCaptureMachine();

    expect(machine.feed({ kind: "confirm" })).toBeNull();
    expect(machine.feed({ kind: "escape" })).toEqual({ kind: "cancel" });

    machine.reset();
    machine.feed({ kind: "modifier", modifier: "RightCtrl", down: true });
    expect(machine.feed({ kind: "confirm" })).toBeNull();
    machine.feed({ kind: "modifier", modifier: "RightCtrl", down: false });
    expect(machine.feed({ kind: "confirm" })).toEqual({
      kind: "commit",
      chord: "RightCtrl",
    });
  });

  it("flags typing-hot lone modifiers outside the safe set only", () => {
    const safe = createCaptureMachine();
    safe.feed({ kind: "modifier", modifier: "RightMeta", down: true });
    safe.feed({ kind: "modifier", modifier: "RightMeta", down: false });
    expect(safe.getSnapshot().typingWarning).toBe(false);

    const risky = createCaptureMachine();
    risky.feed({ kind: "modifier", modifier: "LeftCtrl", down: true });
    risky.feed({ kind: "modifier", modifier: "LeftCtrl", down: false });
    expect(risky.getSnapshot()).toMatchObject({
      phase: "captured",
      chord: "LeftCtrl",
      typingWarning: true,
    });
  });

  it("can start already captured from an existing chord", () => {
    const machine = createCaptureMachine("RightCtrl+RightShift");

    expect(machine.getSnapshot()).toMatchObject({
      phase: "captured",
      chord: "RightCtrl+RightShift",
      typingWarning: false,
    });
  });
});
