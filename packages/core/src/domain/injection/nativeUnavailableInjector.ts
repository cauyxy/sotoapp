import type { Injector } from "../voice/runVoiceSession.js";

export function createNativeUnavailableInjector(): Injector {
  return {
    inject: async () => ({
      kind: "manual_copy_required",
      reason: "native_unavailable",
    }),
  };
}
