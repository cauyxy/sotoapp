// Engine composition shapes (engine spec §4.3). ResolvedProviderConfig is a
// saved config joined with its secret + catalog defaults — the same shape the
// chat/asr clients consume, capability-tagged.

import type { Capability } from "../../contract/schema.js";
import {
  capabilityDefaultsFor,
  providerDefaultsFor,
  type RequestProfile,
} from "../provider/catalog.js";
import { ProviderException } from "../provider/omni/errors.js";

export interface ResolvedProviderConfig {
  providerId: string;
  capability: Capability;
  model: string;
  baseUrl: string;
  apiKey: string;
  requestProfile: RequestProfile;
}

export type EngineSpec =
  | { kind: "omni"; config: ResolvedProviderConfig }
  | {
      kind: "asr_llm";
      asr: ResolvedProviderConfig;
      llm: ResolvedProviderConfig;
      /** Forwarded to AsrHints (resolved from settings at wiring time). */
      languageHint: string | null;
    };

/**
 * Join a saved config (+ decrypted api key) with its catalog capability
 * defaults: blank model/base URL fill from the catalog; a vendor without the
 * requested capability is an invalid configuration (strict, no fallback).
 */
export function resolveProviderConfig(
  saved: {
    provider_id: string;
    capability: Capability;
    model: string;
    base_url: string | null;
  },
  apiKey: string,
): ResolvedProviderConfig {
  const provider = providerDefaultsFor(saved.provider_id);
  const defaults = capabilityDefaultsFor(saved.provider_id, saved.capability);
  if (provider === null || defaults === null) {
    throw new ProviderException(
      "invalid_configuration",
      `Provider '${saved.provider_id}' does not support the '${saved.capability}' capability.`,
    );
  }
  const model = saved.model.trim().length === 0 ? defaults.defaultModel : saved.model.trim();
  const baseUrl =
    saved.base_url === null || saved.base_url.trim().length === 0
      ? provider.defaultBaseUrl
      : saved.base_url.trim().replace(/\/+$/u, "");
  return {
    providerId: provider.providerId,
    capability: saved.capability,
    model,
    baseUrl,
    apiKey,
    requestProfile: defaults.requestProfile,
  };
}
