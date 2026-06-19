// Pure-TS port of soto_hotkey::state_machine::HotkeyMachine. Recording-flow
// state machine driven by the session layer: a hotkey_down starts a recording,
// and hotkey_up / escape / recording_error stop it with a reason. `idle` and
// `stopping` ignore events that don't apply (the statig `Super` fall-through).
// External code reads `lastStopReason` then constructs a fresh machine to
// return to idle.

export type RecordingState = "idle" | "recording_active" | "stopping";

export type StopReason = "completed" | "cancelled" | "failed";

export type RecordingEvent =
  | { type: "hotkey_down"; modeId: string; at: number }
  | { type: "hotkey_up"; at: number }
  | { type: "escape" }
  | { type: "recording_error"; message: string };

export class RecordingSessionMachine {
  state: RecordingState = "idle";
  modeId: string | null = null;
  startedAt: number | null = null;
  lastStopReason: StopReason | null = null;

  handle(event: RecordingEvent): void {
    switch (this.state) {
      case "idle":
        if (event.type === "hotkey_down") {
          this.modeId = event.modeId;
          this.startedAt = event.at;
          this.lastStopReason = null;
          this.state = "recording_active";
        }
        return;
      case "recording_active":
        switch (event.type) {
          case "hotkey_up":
            this.stop("completed");
            return;
          case "escape":
            this.stop("cancelled");
            return;
          case "recording_error":
            this.stop("failed");
            return;
          default:
            return;
        }
      case "stopping":
        return;
    }
  }

  private stop(reason: StopReason): void {
    this.lastStopReason = reason;
    this.state = "stopping";
  }
}
