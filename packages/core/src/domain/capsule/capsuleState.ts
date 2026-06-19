// Pure capsule state reducer (plan §5).
//
// The capsule window reflects the recording lifecycle driven by the
// `soto://voice-runtime` events (VoiceRuntimeEvent). This is a plain reducer —
// NOT XState — so the renderer can wrap it in useReducer (or feed it from an
// XState service). It is pure and immutable: every call returns a new state
// object and never mutates its inputs.

import type { InjectionOutcome, SessionStatus } from "../../contract/schema.js";
import type { VoiceRuntimeEvent } from "../../contract/events.js";
import type { RuntimeEmptyReasonSchema } from "../../contract/events.js";
import type { z } from "zod";

export type RuntimeEmptyReason = z.infer<typeof RuntimeEmptyReasonSchema>;

/** The capsule's view of a terminal session result. */
export interface CompleteResult {
  history_id: string;
  raw_text: string;
  final_text: string;
  status: SessionStatus;
  injection_outcome: InjectionOutcome;
  empty_reason?: RuntimeEmptyReason;
}

export type CapsulePhase =
  | "idle"
  | "listening"
  | "thinking"
  | "inserting"
  | "completed"
  | "cancelled"
  | "failed";

export interface CapsuleLevel {
  rms: number;
  peak: number;
}

export interface CapsuleState {
  phase: CapsulePhase;
  modeId: string | null;
  /** Display name of the running mode (drives the intro label), or null. */
  modeName: string | null;
  level: CapsuleLevel;
  result: CompleteResult | null;
  errorMessage: string | null;
}

export const initialCapsuleState: CapsuleState = {
  phase: "idle",
  modeId: null,
  modeName: null,
  level: { rms: 0, peak: 0 },
  result: null,
  errorMessage: null,
};

const RAW_LEVEL_MAX = 65535;

/**
 * Map a raw runtime level sample (0..65535, the wire range) onto a 0..1 meter
 * value. Out-of-range input is clamped.
 */
export function normalizeLevel(raw: number): number {
  if (raw <= 0) return 0;
  if (raw >= RAW_LEVEL_MAX) return 1;
  return raw / RAW_LEVEL_MAX;
}

// Project a completed/cancelled/failed event onto the capsule's CompleteResult
// shape (dropping processed_text, which the capsule does not surface).
function toCompleteResult(
  event: Extract<
    VoiceRuntimeEvent,
    { kind: "completed" | "cancelled" | "failed" }
  >,
): CompleteResult {
  const result: CompleteResult = {
    history_id: event.history_id,
    raw_text: event.raw_text,
    final_text: event.final_text,
    status: event.status,
    injection_outcome: event.injection_outcome,
  };
  if (event.empty_reason !== undefined) {
    result.empty_reason = event.empty_reason;
  }
  return result;
}

/**
 * Pure reducer over the voice-runtime event stream.
 *
 * Transitions:
 *   started   -> listening (set modeId; clear stale result/error)
 *   thinking  -> thinking
 *   inserting -> inserting
 *   level     -> updates level only (phase unchanged — tolerated in any order)
 *   completed -> completed + result
 *   cancelled -> cancelled + result
 *   failed    -> failed + result
 *   error     -> failed + errorMessage
 */
export function capsuleReducer(
  state: CapsuleState,
  event: VoiceRuntimeEvent,
): CapsuleState {
  switch (event.kind) {
    case "started":
      return {
        ...state,
        phase: "listening",
        modeId: event.mode_id,
        modeName: event.mode_name,
        level: { rms: 0, peak: 0 },
        result: null,
        errorMessage: null,
      };

    case "thinking":
    case "inserting":
      return {
        ...state,
        phase: event.kind,
        modeId: event.mode_id,
        modeName: event.mode_name,
      };

    case "level":
      return {
        ...state,
        level: { rms: event.rms, peak: event.peak },
      };

    case "completed":
    case "cancelled":
    case "failed":
      return {
        ...state,
        phase: event.kind,
        result: toCompleteResult(event),
      };

    case "error":
      return {
        ...state,
        phase: "failed",
        errorMessage: event.message,
      };

    case "slow":
      return state;
  }
}
