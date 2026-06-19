import { z } from "zod";

/** u64 unix-ms timestamp; accepts a JSON number or bigint, yields bigint. */
const timestamp = z.coerce.bigint();

/** Provider capability roles (engine spec section 3.1). */
export const CapabilitySchema = z.enum(["omni", "asr", "llm"]);
export type Capability = z.infer<typeof CapabilitySchema>;

/** Engine pipeline mode (engine spec section 3.4). */
export const EngineModeSchema = z.enum(["omni", "asr_llm"]);
export type EngineMode = z.infer<typeof EngineModeSchema>;

export const ValidationStatusSchema = z.enum(["unspecified", "ok", "warn", "err"]);

export const ProviderConfigValidationSchema = z.object({
  last_validated_at: timestamp.nullable(),
  last_validated_latency_ms: z.number().nullable(),
  last_validated_status: ValidationStatusSchema,
  last_validated_note: z.string().nullable(),
  last_validated_sample: z.string().nullable(),
  last_validated_sample_result: z.string().nullable(),
});

export const ProviderConfigSchema = z.object({
  config_id: z.string(),
  provider_id: z.string(),
  display_name: z.string().nullable(),
  model: z.string(),
  base_url: z.string().nullable(),
  is_default: z.boolean(),
  // Which engine role this config plays (engine spec section 3.1). Default
  // "omni" so existing single-hop configs deserialize as omni providers.
  capability: CapabilitySchema.default("omni"),
  validation: ProviderConfigValidationSchema,
  created_at: timestamp,
  updated_at: timestamp,
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
