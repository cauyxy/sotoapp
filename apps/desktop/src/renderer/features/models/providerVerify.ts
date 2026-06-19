// Verify-state machine for one provider config — drives the 模型 form's
// save-and-verify round trip (lives with the models feature, the only consumer
// after the engine pickers replaced the old Engine panel). A plain `onState`
// callback feeds React local state.
//
// Each verify() increments a generation counter; an older run that resolves after
// a newer one is ignored, so a rapid second click can't be clobbered by a slow
// first click's late result.

import type { ProviderConfig } from "@soto/core";
import type { TestProviderResult } from "../../ipc";
import {
  draftFromConfig,
  type ModelConfigDraft,
} from "./modelsDraft";

export type VerifyState = { kind: "idle" } | { kind: "running" };

export type VerifyResult =
  | { kind: "ok"; latency_ms: number; note: string; saved: ProviderConfig }
  | { kind: "verify_failed"; latency_ms: number; note: string; saved: ProviderConfig }
  | { kind: "save_failed"; note: string }
  | { kind: "timed_out"; saved: ProviderConfig | null };

// Upper bound on a single verify run; thirty seconds means the backend (or the
// user's network) is wedged.
export const PROVIDER_VERIFY_TIMEOUT_MS = 30_000;

export interface CreateProviderVerifyOptions<TDraft extends ModelConfigDraft> {
  getDraft: () => TDraft | null;
  setDraft: (next: TDraft) => void;
  save: (draft: TDraft) => Promise<ProviderConfig>;
  test: (configId: string) => Promise<TestProviderResult>;
  onState: (state: VerifyState) => void;
  errorContext: string;
  timeoutMs?: number;
}

export function createProviderVerify<TDraft extends ModelConfigDraft>({
  getDraft,
  setDraft,
  save,
  test,
  onState,
  errorContext,
  timeoutMs = PROVIDER_VERIFY_TIMEOUT_MS,
}: CreateProviderVerifyOptions<TDraft>): { verify: () => Promise<VerifyResult> } {
  let generation = 0;

  async function verify(): Promise<VerifyResult> {
    const draft = getDraft();
    if (!draft) return { kind: "save_failed", note: "No draft available." };
    // A credential is required to create a config; on edit (config_id present)
    // a blank credential keeps the existing secret. doubao-asr supplies its
    // credential through the App Key / Access Key pair instead of api_key.
    const hasCredential =
      draft.api_key.trim().length > 0 ||
      draft.app_key.trim().length > 0 ||
      draft.access_key.trim().length > 0;
    if (!hasCredential && !draft.config_id) {
      return { kind: "save_failed", note: "No API key provided." };
    }

    const ticket = ++generation;
    onState({ kind: "running" });

    const TIMEOUT: unique symbol = Symbol.for("provider-verify-timeout") as never;
    type TimeoutMarker = typeof TIMEOUT;

    const timer = new Promise<TimeoutMarker>((resolve) => {
      globalThis.setTimeout(() => resolve(TIMEOUT), timeoutMs);
    });

    try {
      // The draft owns its own is_default (omni-only invariant; non-omni configs
      // never claim the default slot). saveRequestFromDraft clamps it per-capability.
      const saved = await Promise.race([save(draft), timer]);
      // Both guards consume the awaited result; supersession keeps priority over
      // a late timeout (same order as before), so the bail reads the value the
      // await produced rather than blocking ahead of an unrelated guard.
      const supersededAfterSave = ticket !== generation;
      if (supersededAfterSave || saved === TIMEOUT) {
        onState({ kind: "idle" });
        return supersededAfterSave
          ? { kind: "save_failed", note: "Verification superseded." }
          : { kind: "timed_out", saved: null };
      }

      const committed = saved as ProviderConfig;
      setDraft(draftFromConfig(committed) as TDraft);

      const tested = await Promise.race([test(committed.config_id), timer]);
      const supersededAfterTest = ticket !== generation;
      if (supersededAfterTest || tested === TIMEOUT) {
        onState({ kind: "idle" });
        return supersededAfterTest
          ? { kind: "save_failed", note: "Verification superseded." }
          : { kind: "timed_out", saved: committed };
      }

      const validated = tested as TestProviderResult;
      onState({ kind: "idle" });
      if (validated.status === "ok") {
        return {
          kind: "ok",
          latency_ms: validated.latency_ms,
          note: validated.note,
          saved: committed,
        };
      }

      return {
        kind: "verify_failed",
        latency_ms: validated.latency_ms,
        note: validated.note || "Verification failed.",
        saved: committed,
      };
    } catch (error) {
      if (ticket !== generation) {
        onState({ kind: "idle" });
        return { kind: "save_failed", note: "Verification superseded." };
      }

      console.error(errorContext, error);
      const message = error instanceof Error ? error.message : String(error);
      onState({ kind: "idle" });
      return { kind: "save_failed", note: message };
    }
  }

  return { verify };
}
