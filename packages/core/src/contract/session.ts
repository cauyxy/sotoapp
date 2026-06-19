import { z } from "zod";

export const SessionStatusSchema = z.enum([
  "completed",
  "empty",
  "failed",
  "cancelled",
]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

const ManualFallbackReasonSchema = z
  .enum([
    "paste_unverified",
    "paste_send_failed",
    "clipboard_busy",
    "clipboard_unrestorable",
    "native_unavailable",
  ])
  .optional();

const ManualCopyRequiredOutcomeSchema = z.object({
  kind: z.literal("manual_copy_required"),
  reason: ManualFallbackReasonSchema,
});

export const InjectionOutcomeSchema = z.union([
  z.object({
    kind: z.literal("paste_sent"),
    method: z.literal("paste").optional(),
  }),
  ManualCopyRequiredOutcomeSchema,
  z.object({ kind: z.literal("no_op") }),
  z.object({ kind: z.literal("failed"), detail: z.string() }),
  z.object({
    kind: z.literal("focus_lost"),
    detail: z.object({
      saved_app_name: z.string(),
      actual_app_name: z.string(),
    }),
  }),
]);
export type InjectionOutcome = z.infer<typeof InjectionOutcomeSchema>;
