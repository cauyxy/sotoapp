import { writable, type Readable } from "svelte/store";

import {
  createProviderDraft,
  type ProviderConfig,
  type ProviderConfigDraft,
  type ProviderTestResult
} from "../../ipc/providers";

export type VerifyState = { kind: "idle" } | { kind: "running" };

export type VerifyResult =
  | { kind: "ok"; latency_ms: number; note: string; saved: ProviderConfig }
  | { kind: "verify_failed"; latency_ms: number; note: string; saved: ProviderConfig }
  | { kind: "save_failed"; note: string }
  | { kind: "timed_out"; saved: ProviderConfig | null };

// Upper bound on a single verify run. Save + test should typically resolve in
// a second or two; thirty seconds means the backend (or the user's network)
// is wedged.
export const PROVIDER_VERIFY_TIMEOUT_MS = 30_000;

export interface CreateProviderVerifyOptions<TDraft extends ProviderConfigDraft> {
  getDraft: () => TDraft | null;
  setDraft: (next: TDraft) => void;
  save: (draft: TDraft) => Promise<ProviderConfig>;
  test: (configId: string) => Promise<ProviderTestResult>;
  errorContext: string;
  // Override timeout in tests. Production paths use the default above.
  timeoutMs?: number;
}

// Verify-state machine for one provider slot. Callers wire in the right IPC
// callbacks. Returns a reactive `state` store and a `verify()` action.
//
// Each call to `verify()` increments a generation counter; any older run that
// resolves afterwards is ignored. That guarantees a rapid second click can't
// be overwritten by a slow first click's late result.
export function createProviderVerify<TDraft extends ProviderConfigDraft>({
  getDraft,
  setDraft,
  save,
  test,
  errorContext,
  timeoutMs = PROVIDER_VERIFY_TIMEOUT_MS
}: CreateProviderVerifyOptions<TDraft>): {
  state: Readable<VerifyState>;
  verify: () => Promise<VerifyResult>;
} {
  const state = writable<VerifyState>({ kind: "idle" });
  let generation = 0;

  async function verify(): Promise<VerifyResult> {
    const draft = getDraft();
    if (!draft) return { kind: "save_failed", note: "No draft available." };
    if (!draft.api_key.trim() && !draft.config_id) {
      return { kind: "save_failed", note: "No API key provided." };
    }

    const ticket = ++generation;
    state.set({ kind: "running" });

    const TIMEOUT: unique symbol = Symbol.for("provider-verify-timeout") as never;
    type TimeoutMarker = typeof TIMEOUT;

    const timer = new Promise<TimeoutMarker>((resolve) => {
      globalThis.setTimeout(() => resolve(TIMEOUT), timeoutMs);
    });

    try {
      const saved = await Promise.race([save({ ...draft, is_default: true }), timer]);
      if (ticket !== generation) {
        state.set({ kind: "idle" });
        return { kind: "save_failed", note: "Verification superseded." };
      }

      if (saved === TIMEOUT) {
        state.set({ kind: "idle" });
        return { kind: "timed_out", saved: null };
      }

      const committed = saved as ProviderConfig;
      setDraft(createProviderDraft(committed) as TDraft);

      const tested = await Promise.race([test(committed.config_id), timer]);
      if (ticket !== generation) {
        state.set({ kind: "idle" });
        return { kind: "save_failed", note: "Verification superseded." };
      }

      if (tested === TIMEOUT) {
        state.set({ kind: "idle" });
        return { kind: "timed_out", saved: committed };
      }

      const validated = tested as ProviderTestResult;
      state.set({ kind: "idle" });
      if (validated.status === "ok") {
        return {
          kind: "ok",
          latency_ms: validated.latency_ms,
          note: validated.note,
          saved: committed
        };
      }

      return {
        kind: "verify_failed",
        latency_ms: validated.latency_ms,
        note: validated.note || "Verification failed.",
        saved: committed
      };
    } catch (error) {
      if (ticket !== generation) {
        state.set({ kind: "idle" });
        return { kind: "save_failed", note: "Verification superseded." };
      }

      console.error(errorContext, error);
      const message = error instanceof Error ? error.message : String(error);
      state.set({ kind: "idle" });
      return { kind: "save_failed", note: message };
    }
  }

  return { state, verify };
}
