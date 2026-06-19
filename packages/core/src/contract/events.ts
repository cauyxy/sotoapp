// Zod schemas for renderer-facing runtime event payloads. The field names keep
// the snake_case wire contract that the Electron main process emits.
//
// All wire fields and enum tags are snake_case; the discriminator key is "kind".
// Newtype-of-struct variants (started/thinking/inserting/completed/cancelled/failed)
// flatten their inner struct's fields directly next to "kind" (serde internal
// tagging) — there is no nested handle/result object.

import { z } from "zod";
// Reuse the canonical DTO schemas + event-channel constants from schema.ts
// rather than redefining them here (single source of truth).
import { InjectionOutcomeSchema, SessionStatusSchema } from "./schema.js";

// The HOTKEY_RUNTIME_ACTION_EVENT / VOICE_RUNTIME_EVENT channel constants live
// in schema.js (exported via the barrel) — this module owns only the payload
// schemas. The HotkeySessionAction -> wire mapper (hotkeyRuntimeActionFor)
// lives in domain/hotkey/runtime.ts: it bridges a session action to this wire
// shape and so belongs in the domain layer, not the contract layer.

// --- soto://hotkey-runtime-action ----------------------------------------

export const HotkeyRuntimeActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("start_recording"), mode_id: z.string() }),
  z.object({ kind: z.literal("finish_recording"), mode_id: z.string() }),
  z.object({ kind: z.literal("cancel_recording"), mode_id: z.string() }),
]);
export type HotkeyRuntimeAction = z.infer<typeof HotkeyRuntimeActionSchema>;

// --- soto://voice-runtime ------------------------------------------------

// Runtime EmptyReason includes no_recognition (the gate-only EmptyReason in
// recordingValidator.ts is the 2-value subset).
export const RuntimeEmptyReasonSchema = z.enum([
  "too_short",
  "silent",
  "no_recognition",
]);
export const VoiceSessionStatusSchema = z.enum(["listening", "thinking", "inserting"]);
export const VoiceRuntimeErrorCodeSchema = z.enum([
  "missing_provider",
  // The resolved/selected mode no longer exists — surfaced explicitly instead of
  // silently transcribing with an empty prompt.
  "missing_mode",
  // The voice runtime itself can't run a session (e.g. no fetch transport).
  "runtime_unavailable",
  "generic",
]);
export type VoiceRuntimeErrorCode = z.infer<typeof VoiceRuntimeErrorCodeSchema>;

// VoiceSessionHandle fields, flattened into started/thinking.
const handleFields = {
  handle_id: z.string(),
  mode_id: z.string(),
  status: VoiceSessionStatusSchema,
  // Mode identity for the capsule's mode-aware visuals. mode_name is the
  // resolved mode's display name, null if unresolved.
  mode_name: z.string().nullable(),
};

// CompleteFinalTranscriptResult fields, flattened into completed/cancelled/failed.
const resultFields = {
  history_id: z.string(),
  raw_text: z.string(),
  processed_text: z.string().nullable(),
  final_text: z.string(),
  status: SessionStatusSchema,
  injection_outcome: InjectionOutcomeSchema,
  // Omitted entirely when None (skip_serializing_if) — optional, not nullable.
  empty_reason: RuntimeEmptyReasonSchema.optional(),
};

export const VoiceRuntimeEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("started"), ...handleFields }),
  z.object({ kind: z.literal("thinking"), ...handleFields }),
  z.object({ kind: z.literal("inserting"), ...handleFields }),
  z.object({ kind: z.literal("completed"), ...resultFields }),
  z.object({ kind: z.literal("cancelled"), ...resultFields }),
  z.object({ kind: z.literal("failed"), ...resultFields }),
  z.object({
    kind: z.literal("error"),
    code: VoiceRuntimeErrorCodeSchema,
    message: z.string(),
  }),
  z.object({
    kind: z.literal("level"),
    rms: z.number().int().min(0).max(65535),
    peak: z.number().int().min(0).max(65535),
  }),
  // Emitted by main while a session has been "thinking" for a while (8s / 20s)
  // so the Panel can reassure the user. Ignored by the capsule reducer.
  z.object({
    kind: z.literal("slow"),
    mode_id: z.string(),
    elapsed_ms: z.number().int().min(0),
  }),
]);
export type VoiceRuntimeEvent = z.infer<typeof VoiceRuntimeEventSchema>;

// --- permission://updated -------------------------------------------------
// Emitted by main whenever a tracked OS permission (or the derived hotkey-hook
// install state) changes — e.g. after the launch-time Accessibility prompt is
// granted and the global hotkey hook is (re)installed without an app restart.
// Mirrors the old previous desktop shell permission poller's permission://updated channel.
export const PermissionUpdatedEventSchema = z.object({
  accessibility: z.boolean(),
  microphone: z.boolean(),
  /** Whether the global hotkey hook is currently installed (gated on accessibility). */
  hotkey_installed: z.boolean(),
});
export type PermissionUpdatedEvent = z.infer<typeof PermissionUpdatedEventSchema>;
