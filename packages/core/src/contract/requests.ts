// Zod schemas for IPC command *input* (request) DTOs — the renderer→main wire
// contract validated at the trust boundary. Output DTOs live in schema.ts.

import { z } from "zod";
import {
  AppSettingsSchema,
  CapabilitySchema,
  ModeSchema,
} from "./schema.js";

export const PaneSchema = z.enum(["microphone", "accessibility"]);

/**
 * Why the renderer is (re)fetching the aggregated app model. Purely an
 * optimization hint: the main assembler may reuse cached values for expensive
 * sub-reads (renderer-roundtrip microphone enumeration) when the cause cannot
 * have changed them. An absent reason always means a conservative full read.
 */
export const RefreshReasonSchema = z.enum([
  "initial",
  "voice-terminal",
  "history",
  "modes",
  "dictionary",
  "provider",
  "permissions",
  "settings",
]);
export type RefreshReason = z.infer<typeof RefreshReasonSchema>;

export const GetAppModelRequestSchema = z
  .object({ reason: RefreshReasonSchema })
  .optional();

export const HotkeyConflictPolicySchema = z.enum(["reject", "steal"]);

export const SaveModeRequestSchema = z.object({
  request: z.object({
    mode: ModeSchema,
    hotkey_conflict_policy: HotkeyConflictPolicySchema,
  }),
});

export const CreateModeRequestSchema = z.object({
  request: z.object({ name: z.string() }),
});

export const ModeIdParamSchema = z.object({ mode_id: z.string() });

export const SaveDictionaryEntryRequestSchema = z.object({
  request: z.object({
    id: z.string().nullable(),
    term: z.string(),
  }),
});

// save_provider_config both creates (config_id: null) and updates a config —
// there is no separate create command.
const ProviderConfigRequestSchema = z.object({
  provider_id: z.string(),
  display_name: z.string().nullable(),
  model: z.string(),
  base_url: z.string().nullable(),
  api_key: z.string().nullable(),
  is_default: z.boolean(),
  // Engine role this config serves (engine spec §3.1); default "omni" so older
  // renderer payloads (pre engine pickers) save as omni configs.
  capability: CapabilitySchema.default("omni"),
});

export const SaveProviderConfigRequestSchema = z.object({
  request: ProviderConfigRequestSchema.extend({
    config_id: z.string().nullable(),
  }),
});

/** The provider-config payload a save carries (sans config_id). */
export type ProviderConfigRequest = z.infer<typeof ProviderConfigRequestSchema>;

export const TestProviderRequestSchema = z.object({
  request: z.object({
    config_id: z.string(),
    sample: z.string().nullable(),
  }),
});

export const SaveAppSettingsRequestSchema = z.object({ settings: AppSettingsSchema });

/**
 * Native OS confirmation dialog request. `message` is the headline; the rest are
 * optional (a default detail/button label is supplied by the main process when
 * omitted). Used to gate irreversible actions (e.g. clearing all history) behind
 * a real OS dialog instead of a click-through. The handler resolves to a boolean
 * (true = user confirmed).
 */
export const ConfirmDialogSchema = z.object({
  message: z.string(),
  detail: z.string().optional(),
  confirmLabel: z.string().optional(),
  cancelLabel: z.string().optional(),
});
export type ConfirmDialogInput = z.infer<typeof ConfirmDialogSchema>;

export const HistoryIdParamSchema = z.object({ history_id: z.string() });
export const EntryIdParamSchema = z.object({ entry_id: z.string() });
export const ConfigIdParamSchema = z.object({ config_id: z.string() });
export const PaneParamSchema = z.object({ pane: PaneSchema });

// --- Capture lifecycle (renderer capture -> main SessionController) --------
// The renderer owns the microphone (getUserMedia/AudioWorklet). The
// SessionController (main) drives capture start/cancel via a main->renderer
// event channel; the renderer reports lifecycle + the finished audio back over
// these capture_* commands. `session_id` correlates each push with the active
// session the controller started, so a stale/late push from a previous session
// is ignored at the trust boundary's far side (the controller checks identity).

/** Renderer acks that it began capturing for the controller-issued session. */
export const CaptureStartedRequestSchema = z.object({ session_id: z.string() });

/**
 * Renderer pushes the finished recording: a base64 16 kHz mono PCM16 WAV plus
 * the stats the silence/too-short gate needs (peak in [0,1], durationMs, and
 * detected voiced duration). The audio never round-trips through @soto/core — it
 * is opaque here.
 */
export const PushCaptureAudioRequestSchema = z.object({
  session_id: z.string(),
  wav_base64: z.string(),
  duration_ms: z.number().int().nonnegative(),
  peak: z.number().min(0).max(1),
  voiced_ms: z.number().int().nonnegative(),
});

/**
 * Renderer streams a meter sample (0..1) for the active session; main relays it
 * as a `level` voice-runtime event (scaled to the 0..65535 wire range).
 */
export const PushCaptureLevelRequestSchema = z.object({
  session_id: z.string(),
  level: z.number().min(0).max(1),
});

/** Renderer reports a capture failure (e.g. mic denied) for the session. */
export const ReportCaptureErrorRequestSchema = z.object({
  session_id: z.string(),
  message: z.string(),
});

/** No-argument commands accept only `undefined` at the boundary. */
export const NoArgsSchema = z.void();
