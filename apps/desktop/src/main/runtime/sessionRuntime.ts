// Voice session runtime: the single main-process seam where store reads,
// engine wiring, native injection, and @soto/core orchestration deps meet.

import {
  createNativeUnavailableInjector,
  createEngineModelRuntime,
  type Injector,
  ProviderException,
  resolveActiveCapabilityConfigId,
  resolveActiveProviderConfigId,
  resolveProviderConfig,
  type AppSettings,
  type EngineSpec,
  type FetchLike,
  type PostInsertObserver,
  type VoiceSessionDeps,
  type WebSocketFactory,
} from "@soto/core";
import type { InjectionNativePort, NativeFacilities } from "@soto/native-bridge";
import type { SqliteStore } from "../db/store.js";
import { createPlatformInjector } from "../native/platformInjector.js";
import { createManagedDashscopeRealtimeWebSocketFactory } from "./realtimeSocket.js";
import type { SessionContext, SessionResolveFailure } from "../voice/sessionController.js";

interface VoiceSessionDepsBaseConfig {
  store: SqliteStore;
  fetchFn: FetchLike;
  webSocketFn?: WebSocketFactory;
  /**
   * Resolved engine wiring (provider plumbing only — behavior bits ride each
   * ModelInput). sessionRuntime joins the active config(s) with
   * their secrets + catalog defaults; the engine stamps the recognition
   * source's provider/model onto the ModelOutput trace, which
   * runVoiceSession copies onto the HistoryRecord.
   */
  engineSpec: EngineSpec;
  now: () => number;
  uuid: () => string;
  settings: AppSettings;
  postInsertObserver?: PostInsertObserver;
  log?: (message: string) => void;
}

export type VoiceSessionDepsConfig = VoiceSessionDepsBaseConfig &
  (
    | { injectionNative: InjectionNativePort; injector?: undefined }
    | { injector: Injector; injectionNative?: undefined }
  );

export function createVoiceSessionDeps(cfg: VoiceSessionDepsConfig): VoiceSessionDeps {
  const { store } = cfg;
  let injector: Injector;
  if (cfg.injector !== undefined) {
    injector = cfg.injector;
  } else {
    injector = createPlatformInjector(cfg.injectionNative, {
      ...(cfg.log !== undefined ? { log: cfg.log } : {}),
    });
  }
  const deps: VoiceSessionDeps = {
    modelRuntime: createEngineModelRuntime(cfg.engineSpec, {
      fetch: cfg.fetchFn,
      ...(cfg.webSocketFn !== undefined ? { webSocket: cfg.webSocketFn } : {}),
    }),
    injector,
    history: {
      append: async (record) => {
        store.appendHistory(record);
      },
    },
    dictionary: {
      readDictionary: async () => store.listDictionary(),
    },
    now: cfg.now,
    uuid: cfg.uuid,
    historyEnabled: cfg.settings.history_enabled,
  };
  if (cfg.postInsertObserver !== undefined) {
    deps.postInsertObserver = cfg.postInsertObserver;
  }
  return deps;
}

/**
 * Resolve the active mode prompt + @soto/core voice-session deps for a session,
 * or a TYPED failure (missing provider / missing mode / runtime unavailable) —
 * no silent fallback to an arbitrary provider or an empty prompt. It shares
 * the active-provider rule with readiness (resolveActiveProviderConfigId) so
 * the UI can never show "ready" while a session would fail. Runtime-only
 * (touches the store + global fetch); the SessionController logic that calls
 * it is unit-tested with a fake.
 */
export function makeResolveSession(
  store: SqliteStore,
  facilities: NativeFacilities | null,
  postInsertObserver?: PostInsertObserver,
  log?: (message: string) => void,
): (modeId: string) => Promise<SessionContext | SessionResolveFailure> {
  return async (modeId: string): Promise<SessionContext | SessionResolveFailure> => {
    const settings = store.getSettings();
    const configs = store.listProviderConfigs();

    // The mode must exist. A missing mode is surfaced explicitly rather than
    // papered over with an empty prompt; a found mode with an empty prompt_body
    // is a valid dictation mode (default/translate), so key off existence only.
    const mode = store.getMode(modeId);
    if (mode === null) return { error: "missing_mode" };
    const modePrompt = mode.prompt_body;

    // Engine wiring: join the resolved config(s) with their secrets + catalog
    // defaults into an EngineSpec. A missing/empty api key or an unresolvable
    // config surfaces as missing_provider HERE (before any audio is captured)
    // rather than as a mid-pipeline ProviderException; a non-ProviderException
    // is a programming bug and propagates. Slot/active resolution uses the SAME
    // resolvers readiness uses, so the UI can never show "ready" while a
    // session would fail.
    let engineSpec: EngineSpec;
    if (settings.engine_mode === "asr_llm") {
      // Strict two-slot resolution (spec §6): BOTH slots must point at
      // capability-matching configs because the LLM polish hop is unconditional.
      // No default-flag fallback for slots.
      const asrId = resolveActiveCapabilityConfigId(settings.active_asr_config_id, "asr", configs);
      const llmId = resolveActiveCapabilityConfigId(settings.active_llm_config_id, "llm", configs);
      if (asrId === null || llmId === null) return { error: "missing_provider" };
      // resolveActiveCapabilityConfigId only returns ids found in this same configs array.
      const asrConfig = configs.find((c) => c.config_id === asrId)!;
      const llmConfig = configs.find((c) => c.config_id === llmId)!;
      const asrSecrets = store.getProviderSecrets(asrId);
      const llmSecrets = store.getProviderSecrets(llmId);
      if (asrSecrets === null || asrSecrets.api_key.trim().length === 0) {
        return { error: "missing_provider" };
      }
      if (llmSecrets === null || llmSecrets.api_key.trim().length === 0) {
        return { error: "missing_provider" };
      }
      try {
        engineSpec = {
          kind: "asr_llm",
          asr: resolveProviderConfig(asrConfig, asrSecrets.api_key),
          llm: resolveProviderConfig(llmConfig, llmSecrets.api_key),
          languageHint:
            settings.transcription_language_hint.trim().length > 0
              ? settings.transcription_language_hint.trim()
              : null,
        };
      } catch (e) {
        if (e instanceof ProviderException) return { error: "missing_provider" };
        throw e;
      }
      log?.(
        `session: mode=${modeId} asr=${asrConfig.provider_id}/${asrConfig.model || "(default)"} ` +
          `llm=${llmConfig.provider_id}/${llmConfig.model || "(default)"}`,
      );
    } else {
      // Omni: the active config via the SAME resolver readiness uses — explicit
      // selection or the default-flagged omni config, NEVER an arbitrary first.
      const activeId = resolveActiveProviderConfigId(settings, configs);
      if (activeId === null) return { error: "missing_provider" };
      const activeConfig = configs.find((c) => c.config_id === activeId);
      if (activeConfig === undefined) return { error: "missing_provider" };
      const secrets = store.getProviderSecrets(activeId);
      if (secrets === null || secrets.api_key.trim().length === 0) {
        return { error: "missing_provider" };
      }
      try {
        engineSpec = {
          kind: "omni",
          config: resolveProviderConfig(activeConfig, secrets.api_key),
        };
      } catch (e) {
        if (e instanceof ProviderException) return { error: "missing_provider" };
        throw e;
      }
      log?.(
        `session: mode=${modeId} provider=${activeConfig.provider_id} ` +
          `model=${activeConfig.model || "(default)"}`,
      );
    }

    const globalFetch = (globalThis as { fetch?: unknown }).fetch;
    if (typeof globalFetch !== "function") return { error: "runtime_unavailable" };
    const realtimeSockets = createManagedDashscopeRealtimeWebSocketFactory();

    const deps = createVoiceSessionDeps({
      store,
      fetchFn: globalFetch as Parameters<typeof createVoiceSessionDeps>[0]["fetchFn"],
      webSocketFn: realtimeSockets.webSocket,
      ...(facilities?.injection
        ? { injectionNative: facilities.injection }
        : { injector: createNativeUnavailableInjector() }),
      engineSpec,
      now: () => Date.now(),
      uuid: () =>
        globalThis.crypto?.randomUUID?.() ??
        `${Date.now()}-${Math.round(Math.random() * 1e9)}`,
      settings,
      ...(postInsertObserver !== undefined ? { postInsertObserver } : {}),
      ...(log !== undefined ? { log } : {}),
    });

    return { modePrompt, deps, dispose: realtimeSockets.dispose };
  };
}
