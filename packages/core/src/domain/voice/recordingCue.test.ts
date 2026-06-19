import { describe, expect, it } from "vitest";

import { RecordingCueGate } from "./recordingCue.js";

describe("RecordingCueGate", () => {
  it("plays the start cue on the first real start only", () => {
    const gate = new RecordingCueGate();
    expect(gate.onRecordingStarted()).toBe("start");
    expect(gate.onRecordingStarted()).toBeNull(); // no double start
    expect(gate.isRecording).toBe(true);
  });

  it("plays the stop cue once on a real stop", () => {
    const gate = new RecordingCueGate();
    gate.onRecordingStarted();
    expect(gate.onRecordingStopped()).toBe("stop");
    expect(gate.onRecordingStopped()).toBeNull(); // repeated stop is silent
    expect(gate.isRecording).toBe(false);
  });

  it("never plays a stop cue without a start", () => {
    const gate = new RecordingCueGate();
    expect(gate.onRecordingStopped()).toBeNull();
  });

  it("abort ends the recording silently and suppresses a later stop", () => {
    const gate = new RecordingCueGate();
    gate.onRecordingStarted();
    gate.abort();
    expect(gate.isRecording).toBe(false);
    expect(gate.onRecordingStopped()).toBeNull(); // aborted → no stop cue
  });

  it("supports back-to-back sessions (start/stop/start/stop)", () => {
    const gate = new RecordingCueGate();
    expect(gate.onRecordingStarted()).toBe("start");
    expect(gate.onRecordingStopped()).toBe("stop");
    expect(gate.onRecordingStarted()).toBe("start");
    expect(gate.onRecordingStopped()).toBe("stop");
  });

  it("a start after an abort works normally", () => {
    const gate = new RecordingCueGate();
    gate.onRecordingStarted();
    gate.abort();
    expect(gate.onRecordingStarted()).toBe("start");
    expect(gate.onRecordingStopped()).toBe("stop");
  });
});
