import { z } from "zod";
import { EngineModeSchema } from "./provider.js";

export const AppSettingsSchema = z.object({
  locale: z.string(),
  active_provider_config_id: z.string().nullable(),
  // Engine pipeline selection + the per-mode slot ids for the inactive mode are
  // never deleted (engine spec section 3.4). active_provider_config_id keeps
  // meaning "active omni config"; the two ids below select the asr_llm slots.
  engine_mode: EngineModeSchema.default("omni"),
  active_asr_config_id: z.string().nullable().default(null),
  active_llm_config_id: z.string().nullable().default(null),
  transcription_language_hint: z.string(),
  microphone_device_id: z.string().nullable(),
  input_level: z.number(),
  history_enabled: z.boolean(),
  include_window_context_in_requests: z.boolean().default(true),
  theme: z.string(),
  use_proxy: z.boolean(),
  history_retention_days: z.number(),
  current_mode_id: z.string().nullable(),
  audio_retention_enabled: z.boolean(),
  hide_app_icon: z.boolean().default(false),
  launch_at_login: z.boolean().default(true),
  base_text_scale: z.enum(["small", "default", "large"]).default("default"),
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;
