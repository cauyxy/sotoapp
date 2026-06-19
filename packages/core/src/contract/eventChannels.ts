import type { z } from "zod";
import {
  CAPTURE_CONTROL_EVENT,
  CaptureControlEventSchema,
  PERMISSION_UPDATED_EVENT,
  VOICE_RUNTIME_EVENT,
} from "./schema.js";
import { PermissionUpdatedEventSchema, VoiceRuntimeEventSchema } from "./events.js";

// Only channels that are actually emitted main→renderer belong here. The
// hotkey runtime action is dispatched in-process (not over IPC), so it is
// intentionally absent — add it if/when it becomes an emitted event.
const REGISTRY: Record<string, z.ZodTypeAny> = {
  [VOICE_RUNTIME_EVENT]: VoiceRuntimeEventSchema,
  [PERMISSION_UPDATED_EVENT]: PermissionUpdatedEventSchema,
  [CAPTURE_CONTROL_EVENT]: CaptureControlEventSchema,
};

export interface OutboundValidation {
  ok: boolean;
  error?: string;
}

export function validateOutboundEvent(channel: string, payload: unknown): OutboundValidation {
  const schema = REGISTRY[channel];
  if (schema === undefined) return { ok: true };
  const parsed = schema.safeParse(payload);
  return parsed.success ? { ok: true } : { ok: false, error: parsed.error.message };
}
