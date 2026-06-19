// Pure-TS decision for classifying a finished injection outcome. The DB/file
// walks that consume it live in the Electron main process; only this pure
// kernel is unit-testable here.

import type { InjectionOutcome, SessionStatus } from "../../contract/schema.js";

/**
 * Classify a session outcome. Empty raw text wins (no recognition); otherwise a
 * failed/focus-lost injection is a failure; otherwise completed. (Note:
 * raw_text is checked un-trimmed.)
 */
export function sessionStatusFor(
  rawText: string,
  injectionOutcome: InjectionOutcome,
): SessionStatus {
  if (rawText.length === 0) return "empty";
  if (
    injectionOutcome.kind === "failed" ||
    injectionOutcome.kind === "focus_lost"
  ) {
    return "failed";
  }
  return "completed";
}
