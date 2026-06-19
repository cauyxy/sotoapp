import { z } from "zod";
import { AxContextSchema } from "./ax.js";

export const EditedTextStatusSchema = z.enum([
  "pending",
  "captured",
  "failed",
  "unavailable",
  "not_observed",
]);

export const EditedTextStatusReasonSchema = z.enum([
  "observer_not_attached",
  "observer_timeout",
  "observer_cancelled",
  "target_changed",
  "focus_lost",
  "secure_input",
  "native_unavailable",
  "read_failed",
  "observer_unsupported",
  "unsupported_injection_outcome",
]);
export type EditedTextStatusReason = z.infer<typeof EditedTextStatusReasonSchema>;

export const PostInsertObservationSchema = z.object({
  edited_text: z.string().nullable(),
  edited_text_status: z.enum(["captured", "failed", "unavailable", "not_observed"]),
  edited_text_status_reason: EditedTextStatusReasonSchema.nullable().default(null),
  ax_context_at_end: AxContextSchema.nullable(),
});
export type PostInsertObservation = z.infer<typeof PostInsertObservationSchema>;
