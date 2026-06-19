import { z } from "zod";

export const AxContextSchema = z.object({
  full_text: z.string(),
  selection_start: z.number(),
  selection_end: z.number(),
  before: z.string(),
  after: z.string(),
  ax_role: z.string().nullable(),
  focused_element_id: z.string().nullable().optional(),
  app_bundle_id: z.string().nullable(),
  app_name: z.string().nullable().default(null),
  window_title: z.string().nullable().default(null),
  web_url: z.string().nullable().default(null),
  web_domain: z.string().nullable().default(null),
});
export type AxContext = z.infer<typeof AxContextSchema>;
