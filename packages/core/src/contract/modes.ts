import { z } from "zod";
import { parseChord } from "../foundation/chord/chord.js";

/** u64 unix-ms timestamp; accepts a JSON number or bigint, yields bigint. */
const timestamp = z.coerce.bigint();

/** A chord string, validated against the canonical chord grammar. */
export const ChordSchema = z.string().superRefine((value, ctx) => {
  try {
    parseChord(value);
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error ? error.message : "invalid chord",
    });
  }
});

export const HotkeyBindingSchema = z.object({ chord: ChordSchema });

export const ModeSchema = z.object({
  id: z.string(),
  name: z.string(),
  prompt_body: z.string(),
  hotkey: HotkeyBindingSchema.nullable(),
  display_order: z.number(),
  built_in: z.boolean(),
  created_at: timestamp,
  updated_at: timestamp,
});
export type Mode = z.infer<typeof ModeSchema>;
