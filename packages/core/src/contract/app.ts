import { z } from "zod";

export const AppInfoSchema = z.object({
  pid: z.number(),
  bundleId: z.string().optional(),
  localizedName: z.string(),
});
export type AppInfo = z.infer<typeof AppInfoSchema>;

export type FocusProbeStatus =
  | "editable"
  | "no_focus"
  | "not_editable"
  | "untrusted"
  | "blocked_elevated"
  | "secure_input"
  | "timeout"
  | "unknown";
