import type { Modifier } from "../../foundation/chord/chord.js";

export interface HotkeyCaptureBeginResult {
  active: boolean;
  suppressing: boolean;
  sessionId: number;
}

export type HotkeyCaptureKey =
  | { kind: "modifier"; modifier: Modifier; down: boolean }
  | { kind: "escape" }
  | { kind: "confirm" }
  | { kind: "other" }
  | { kind: "ended"; reason: "timeout" };
