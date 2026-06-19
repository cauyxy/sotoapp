import { describe, expect, it } from "vitest";
import { RecordingSessionMachine } from "./recordingMachine.js";

describe("RecordingSessionMachine", () => {
  it("starts idle with no mode, start time, or stop reason", () => {
    const machine = new RecordingSessionMachine();
    expect(machine.state).toBe("idle");
    expect(machine.modeId).toBeNull();
    expect(machine.startedAt).toBeNull();
    expect(machine.lastStopReason).toBeNull();
  });

  it("hotkey_down from idle enters recording_active and records the mode + start time", () => {
    const machine = new RecordingSessionMachine();

    machine.handle({ type: "hotkey_down", modeId: "polish", at: 1000 });

    expect(machine.state).toBe("recording_active");
    expect(machine.modeId).toBe("polish");
    expect(machine.startedAt).toBe(1000);
    expect(machine.lastStopReason).toBeNull();
  });

  const recording = () => {
    const machine = new RecordingSessionMachine();
    machine.handle({ type: "hotkey_down", modeId: "polish", at: 1000 });
    return machine;
  };

  it("hotkey_up while recording completes (stopping)", () => {
    const machine = recording();
    machine.handle({ type: "hotkey_up", at: 1500 });
    expect(machine.state).toBe("stopping");
    expect(machine.lastStopReason).toBe("completed");
  });

  it("escape while recording cancels (stopping)", () => {
    const machine = recording();
    machine.handle({ type: "escape" });
    expect(machine.state).toBe("stopping");
    expect(machine.lastStopReason).toBe("cancelled");
  });

  it("recording_error while recording fails (stopping)", () => {
    const machine = recording();
    machine.handle({ type: "recording_error", message: "mic gone" });
    expect(machine.state).toBe("stopping");
    expect(machine.lastStopReason).toBe("failed");
  });

  it("idle ignores stop events", () => {
    const machine = new RecordingSessionMachine();
    machine.handle({ type: "hotkey_up", at: 1 });
    machine.handle({ type: "escape" });
    machine.handle({ type: "recording_error", message: "x" });
    expect(machine.state).toBe("idle");
    expect(machine.lastStopReason).toBeNull();
  });

  it("stopping ignores further events (read reason then build a fresh machine)", () => {
    const machine = recording();
    machine.handle({ type: "hotkey_up", at: 1500 });
    machine.handle({ type: "hotkey_down", modeId: "direct", at: 2000 });
    expect(machine.state).toBe("stopping");
    expect(machine.modeId).toBe("polish");
    expect(machine.lastStopReason).toBe("completed");
  });
});
