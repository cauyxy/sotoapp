// Real provider validation round-trip for the test_provider_config command,
// per capability (engine spec §8): omni/llm run a "reply ok" chat round trip;
// asr pushes the embedded sub-second silent WAV through the real transcribe
// path (HTTP 2xx passes, even with an empty transcript). The stored config is
// first joined with its catalog capability defaults (resolveProviderConfig),
// so an unknown vendor or a capability the vendor does not offer surfaces as
// an invalid_configuration err result. Latency is measured on the runtime
// performance clock. The api_key is read here but never returned — only the
// public ProviderTestResult crosses back to the renderer.

import {
  ASR_VALIDATION_WAV_B64,
  ASR_VALIDATION_WAV_FORMAT,
  OmniClient,
  ProviderException,
  createAsrPort,
  resolveProviderConfig,
  validateLlmConfig,
  type FetchLike,
  type ProviderTestResult,
  type ResolvedProviderConfig,
  type WebSocketFactory,
} from "@soto/core";
import type { SqliteStore } from "../db/store.js";

// ProviderTestResult is canonical in @soto/core (it crosses IPC); re-exported
// so existing main-side import sites keep resolving.
export type { ProviderTestResult } from "@soto/core";

export async function validateProviderConfig(
  store: SqliteStore,
  fetchFn: FetchLike,
  config_id: string,
  webSocketFn?: WebSocketFactory,
): Promise<ProviderTestResult> {
  const started = performance.now();
  const elapsed = (): number => Math.round(performance.now() - started);
  const err = (note: string): ProviderTestResult => ({
    config_id,
    status: "err",
    note,
    latency_ms: elapsed(),
  });

  const config = store.getProviderConfig(config_id);
  if (config === null) {
    return err("Provider config not found.");
  }

  const secrets = store.getProviderSecrets(config_id);
  if (secrets === null || secrets.api_key.trim().length === 0) {
    return err("Provider API key is not set.");
  }

  // Join with the catalog capability defaults exactly the way the engine does.
  // A ProviderException here (unknown vendor / capability not offered) is an
  // invalid configuration result; anything else is a programming bug.
  let resolved: ResolvedProviderConfig;
  try {
    resolved = resolveProviderConfig(config, secrets.api_key);
  } catch (error) {
    if (error instanceof ProviderException) return err(error.message);
    throw error;
  }

  try {
    switch (config.capability) {
      case "omni": {
        const client = new OmniClient({ fetch: fetchFn });
        await client.validate({
          providerId: config.provider_id,
          apiKey: secrets.api_key,
          model: config.model,
          baseUrl: config.base_url ?? "",
        });
        return { config_id, status: "ok", note: "", latency_ms: elapsed() };
      }
      case "llm": {
        await validateLlmConfig({ ...resolved }, { fetch: fetchFn });
        return { config_id, status: "ok", note: "", latency_ms: elapsed() };
      }
      case "asr": {
        // The real transcribe path over the embedded silent WAV; resolving
        // without a throw (HTTP 2xx) passes even when the transcript is empty.
        const port = createAsrPort(resolved, {
          fetch: fetchFn,
          ...(webSocketFn !== undefined ? { webSocket: webSocketFn } : {}),
        });
        await port.transcribe(
          { audioB64: ASR_VALIDATION_WAV_B64, audioFormat: ASR_VALIDATION_WAV_FORMAT },
          { hotwords: [], languageHint: null },
        );
        return { config_id, status: "ok", note: "", latency_ms: elapsed() };
      }
      default: {
        const exhausted: never = config.capability;
        return { config_id, status: "err", note: `Unknown capability '${String(exhausted)}'.`, latency_ms: elapsed() };
      }
    }
  } catch (error) {
    if (error instanceof ProviderException) return err(error.message);
    return err(error instanceof Error ? error.message : String(error));
  }
}
