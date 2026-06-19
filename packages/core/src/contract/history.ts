import { z } from "zod";
import { AxContextSchema } from "./ax.js";
import {
  EditedTextStatusReasonSchema,
  EditedTextStatusSchema,
} from "./observation.js";
import { InjectionOutcomeSchema, SessionStatusSchema } from "./session.js";

/** u64 unix-ms timestamp; accepts a JSON number or bigint, yields bigint. */
const timestamp = z.coerce.bigint();

export const HistoryRecordSchema = z.object({
  id: z.string(),
  created_at: timestamp,
  raw_text: z.string(),
  processed_text: z.string().nullable(),
  injected_text: z.string().nullable(),
  edited_text: z.string().nullable(),
  edited_text_status: EditedTextStatusSchema,
  edited_text_status_reason: EditedTextStatusReasonSchema.nullable().default(null),
  mode_id: z.string().nullable(),
  status: SessionStatusSchema,
  injection_outcome: InjectionOutcomeSchema,
  speaking_duration_ms: timestamp,
  char_count: z.number(),
  target_app: z.string().nullable(),
  target_app_name: z.string().nullable(),
  target_window_title: z.string().nullable(),
  target_control_type: z.string().nullable(),
  ax_context_at_start: AxContextSchema.nullable(),
  ax_context_at_end: AxContextSchema.nullable(),
  audio_path: z.string().nullable(),
  provider_id: z.string().nullable(),
  model_id: z.string().nullable(),
  // Recognition source = provider_id/model_id; these two are the LLM-hop stamp,
  // populated only when the ASR + LLM engine ran a text post-process (engine
  // spec section 3.5). Nullable + default null so older records/callers omit them.
  llm_provider_id: z.string().nullable().default(null),
  llm_model_id: z.string().nullable().default(null),
  detected_language: z.string().nullable(),
  mic_device_id: z.string().nullable(),
});
export type HistoryRecord = z.infer<typeof HistoryRecordSchema>;
