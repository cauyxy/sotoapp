import { z } from "zod";

/** u64 unix-ms timestamp; accepts a JSON number or bigint, yields bigint. */
const timestamp = z.coerce.bigint();

export const DictionarySourceSchema = z.enum(["user_added", "auto_learned"]);

export const DictionaryEntrySchema = z.object({
  id: z.string(),
  term: z.string(),
  source: DictionarySourceSchema,
  hit_count: z.number(),
  last_used_at: timestamp.nullable(),
  created_at: timestamp,
});
export type DictionaryEntry = z.infer<typeof DictionaryEntrySchema>;
