import { describe, expect, it } from "vitest";
import { HotkeySessionCoordinator } from "./hotkeyCoordinator.js";

describe("HotkeySessionCoordinator (toggle)", () => {
  it("first press of a mode starts a session", () => {
    const coordinator = new HotkeySessionCoordinator();

    const action = coordinator.handleEvent({ phase: "pressed", modeId: "polish" });

    expect(action).toEqual({ type: "start", modeId: "polish" });
    expect(coordinator.activeModeId()).toBe("polish");
  });

  it("second press of the same mode completes the session", () => {
    const coordinator = new HotkeySessionCoordinator();
    coordinator.handleEvent({ phase: "pressed", modeId: "polish" });

    const action = coordinator.handleEvent({ phase: "pressed", modeId: "polish" });

    expect(action).toEqual({ type: "complete", modeId: "polish" });
    expect(coordinator.activeModeId()).toBeNull();
  });

  it("a release phase is ignored and does not end an active session", () => {
    const coordinator = new HotkeySessionCoordinator();
    coordinator.handleEvent({ phase: "pressed", modeId: "polish" });

    const action = coordinator.handleEvent({ phase: "released", modeId: "polish" });

    expect(action).toEqual({ type: "ignore" });
    expect(coordinator.activeModeId()).toBe("polish");
  });

  it("a press for a different mode while one is active is ignored", () => {
    const coordinator = new HotkeySessionCoordinator();
    coordinator.handleEvent({ phase: "pressed", modeId: "polish" });

    const action = coordinator.handleEvent({ phase: "pressed", modeId: "direct" });

    expect(action).toEqual({ type: "ignore" });
    expect(coordinator.activeModeId()).toBe("polish");
  });

  it("cancelActive returns cancel for the active mode and clears it", () => {
    const coordinator = new HotkeySessionCoordinator();
    coordinator.handleEvent({ phase: "pressed", modeId: "polish" });

    const action = coordinator.cancelActive();

    expect(action).toEqual({ type: "cancel", modeId: "polish" });
    expect(coordinator.activeModeId()).toBeNull();
  });

  it("cancelActive when idle is ignored", () => {
    const coordinator = new HotkeySessionCoordinator();

    expect(coordinator.cancelActive()).toEqual({ type: "ignore" });
  });

  it("reset returns to idle silently so the next press is a clean start", () => {
    const coordinator = new HotkeySessionCoordinator();
    coordinator.handleEvent({ phase: "pressed", modeId: "polish" });
    expect(coordinator.activeModeId()).toBe("polish");

    coordinator.reset();

    expect(coordinator.activeModeId()).toBeNull();
    expect(coordinator.handleEvent({ phase: "pressed", modeId: "polish" })).toEqual({
      type: "start",
      modeId: "polish",
    });
  });
});
