import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import type {
  EngineSpec,
  FetchLike,
  HistoryRecord,
  TargetContextSnapshot,
  VoiceSessionInput,
} from "@soto/core";
import { AppSettingsSchema, buildAppContext, resolveProviderConfig, runVoiceSession } from "@soto/core";
import { applyMigrations } from "../db/migrate.js";
import { SqliteStore, identityCrypto, freshValidation } from "../db/store.js";
import { createVoiceSessionDeps, makeResolveSession } from "./sessionRuntime.js";
import type { InjectionNativePort } from "@soto/native-bridge";

function freshStore(): SqliteStore {
  const db = new Database(":memory:");
  applyMigrations(db);
  const store = new SqliteStore(db, identityCrypto);
  store.seedIfNeeded();
  return store;
}

// Minimal resolved omni spec for tests that never touch the network.
const omniSpec: EngineSpec = {
  kind: "omni",
  config: {
    providerId: "mimo-api",
    capability: "omni",
    model: "mimo-v2.5",
    baseUrl: "https://api.xiaomimimo.com/v1",
    apiKey: "k",
    requestProfile: "mimo",
  },
};

const fakeNative: InjectionNativePort = {
  frontmostApp: () => ({ pid: 1, bundleId: "com.a", localizedName: "A" }),
  activateApp: () => {},
  probeFocus: () => "not_editable",
  sendPaste: () => true,
  sendPasteDetailed: () => ({ ok: true, operation: "send_paste", platform_code: 0 }),
  clipboardGet: () => "",
  clipboardSet: () => {},
  clipboardSnapshotKind: () => "text",
  clipboardSetTransient: () => {},
};

function record(over: Partial<HistoryRecord> = {}): HistoryRecord {
  return {
    id: "h1",
    created_at: 1n,
    raw_text: "hi",
    processed_text: null,
    injected_text: "hi",
    edited_text: null,
    edited_text_status: "pending",
    edited_text_status_reason: null,
    mode_id: null,
    status: "completed",
    injection_outcome: { kind: "paste_sent" },
    speaking_duration_ms: 500n,
    char_count: 2,
    target_app: null,
    target_app_name: null,
    target_window_title: null,
    target_control_type: null,
    ax_context_at_start: null,
    ax_context_at_end: null,
    audio_path: null,
    provider_id: null,
    model_id: null,
    llm_provider_id: null,
    llm_model_id: null,
    detected_language: null,
    mic_device_id: null,
    ...over,
  };
}

function typecheckCreateVoiceSessionDepsRequiresInjectionDependency() {
  const store = freshStore();

  // @ts-expect-error createVoiceSessionDeps requires either injector or injectionNative
  createVoiceSessionDeps({
    store,
    fetchFn: vi.fn(),
    engineSpec: omniSpec,
    now: () => 1,
    uuid: () => "u",
    settings: store.getSettings(),
  });
}

describe("createVoiceSessionDeps", () => {
  it("wires history.append through to the store", async () => {
    const store = freshStore();
    const deps = createVoiceSessionDeps({
      store,
      fetchFn: vi.fn(),
      injectionNative: fakeNative,
      engineSpec: omniSpec,
      now: () => 1,
      uuid: () => "u",
      settings: store.getSettings(),
    });

    await deps.history.append(record({ id: "wired" }));
    expect(store.listHistory().map((h) => h.id)).toContain("wired");
  });

  it("reads the dictionary through the store", async () => {
    const store = freshStore();
    store.saveDictionaryEntry({
      id: "d1",
      term: "WiredTerm",
      source: "user_added",
      hit_count: 0,
      last_used_at: null,
      created_at: 1n,
    });
    const deps = createVoiceSessionDeps({
      store,
      fetchFn: vi.fn(),
      injectionNative: fakeNative,
      engineSpec: omniSpec,
      now: () => 1,
      uuid: () => "u",
      settings: store.getSettings(),
    });

    const terms = (await deps.dictionary.readDictionary()).map((d) => d.term);
    expect(terms).toContain("WiredTerm");
    expect(terms).toEqual(store.listDictionary().map((d) => d.term));
  });

  it("passes the post-insert observer through to voice-session deps", () => {
    const store = freshStore();
    const postInsertObserver = { start: vi.fn(() => ({ cancel: vi.fn() })) };
    const deps = createVoiceSessionDeps({
      store,
      fetchFn: vi.fn(),
      injectionNative: fakeNative,
      engineSpec: omniSpec,
      now: () => 1,
      uuid: () => "u",
      settings: store.getSettings(),
      postInsertObserver,
    });

    expect(deps.postInsertObserver).toBe(postInsertObserver);
  });

  it("maps settings flags onto the deps", () => {
    const store = freshStore();
    const settings = { ...store.getSettings(), history_enabled: false };
    const deps = createVoiceSessionDeps({
      store,
      fetchFn: vi.fn(),
      injectionNative: fakeNative,
      engineSpec: omniSpec,
      now: () => 1,
      uuid: () => "u",
      settings,
    });
    expect(deps.historyEnabled).toBe(false);
    expect(typeof deps.modelRuntime.respond).toBe("function");
    expect(typeof deps.injector.inject).toBe("function");
  });

  it("persists the resolved config's provider_id/model on the history record (not hardcoded soto-omni)", async () => {
    // End-to-end through the real deps: seed a provider config + secret, run a
    // full session over a fake fetch, and assert the persisted history reflects
    // the chosen provider/model rather than the old hardcoded soto-omni/null.
    const store = freshStore();
    store.upsertProviderConfig({
      config_id: "config.seed",
      provider_id: "doubao-ark",
      display_name: null,
      model: "doubao-1.5-pro",
      base_url: null,
      is_default: true,
      capability: "omni",
      validation: freshValidation(),
      created_at: 1n,
      updated_at: 1n,
    });
    store.putProviderSecrets({
      config_id: "config.seed",
      api_key: "super-secret",
      endpoint: null,
    });

    const okFetch: FetchLike = async () => ({
      status: 200,
      text: async () =>
        JSON.stringify({ choices: [{ message: { content: "hello world" } }] }),
    });

    // Join the saved config with its secret exactly the way resolveSession does.
    const saved = store.getProviderConfig("config.seed")!;
    const secrets = store.getProviderSecrets("config.seed")!;
    const engineSpec: EngineSpec = {
      kind: "omni",
      config: resolveProviderConfig(saved, secrets.api_key),
    };

    const deps = createVoiceSessionDeps({
      store,
      fetchFn: okFetch,
      injectionNative: fakeNative,
      engineSpec,
      now: () => 1,
      uuid: () => "session-1",
      settings: store.getSettings(),
    });

    const snapshot: TargetContextSnapshot = {
      id: "target.session-1",
      capturedAt: 1,
      reason: "voice_session_start",
      platform: process.platform === "win32" ? "windows" : "macos",
      app: {
        pid: 1,
        bundleId: "com.a",
        localizedName: "A",
        executableName: null,
      },
      window: { title: null },
      ax: null,
      focusedElement: null,
      selection: { text: "", source: "none", confidence: "low" },
      ambientClipboard: null,
    };
    const input: VoiceSessionInput = {
      modeId: "mode.default",
      modePrompt: "Transcribe this.",
      recording: {
        audioB64: "ZmFrZQ==",
        audioFormat: "wav",
        durationMs: 1500,
        peak: 0.5,
        voicedMs: 1000,
      },
      savedApp: { pid: 1, bundleId: "com.a", localizedName: "A" },
      axContextAtStart: null,
      target: { app: null, windowTitle: null, controlType: null },
      snapshot,
      appContext: buildAppContext({
        target: snapshot,
        settings: {
          includeWindowContextInRequests: true,
          clipboardContextInRequests: "off",
        },
      }),
    };

    const out = await runVoiceSession(deps, input);
    expect(out.status).toBe("completed");

    const persisted = store.listHistory().find((h) => h.id === out.historyId);
    expect(persisted).toBeDefined();
    expect(persisted!.provider_id).toBe("doubao-ark");
    expect(persisted!.model_id).toBe("doubao-1.5-pro");
  });
});

describe("makeResolveSession", () => {
  it("uses a native-unavailable injector when facilities are absent", async () => {
    const settings = AppSettingsSchema.parse({
      locale: "en-US",
      active_provider_config_id: null,
      engine_mode: "omni",
      active_asr_config_id: null,
      active_llm_config_id: null,
      transcription_language_hint: "",
      microphone_device_id: null,
      input_level: 0,
      history_enabled: true,
      include_window_context_in_requests: true,
      theme: "system",
      use_proxy: false,
      history_retention_days: 30,
      current_mode_id: "mode.default",
      audio_retention_enabled: true,
      hide_app_icon: false,
      base_text_scale: "default",
    });
    const store = {
      getSettings: () => settings,
      listProviderConfigs: () => [
        {
          config_id: "config.seed",
          provider_id: "doubao-ark",
          display_name: null,
          model: "doubao-1.5-pro",
          base_url: null,
          is_default: true,
          capability: "omni",
          validation: freshValidation(),
          created_at: 1n,
          updated_at: 1n,
        },
      ],
      getMode: (modeId: string) =>
        modeId === "mode.default" ? { prompt_body: "Transcribe this." } : null,
      getProviderSecrets: (configId: string) =>
        configId === "config.seed"
          ? { config_id: configId, api_key: "super-secret", endpoint: null }
          : null,
    } as unknown as SqliteStore;

    const runtimeGlobal = globalThis as typeof globalThis & { fetch?: typeof fetch };
    const originalFetch = runtimeGlobal.fetch;
    runtimeGlobal.fetch = vi.fn() as typeof fetch;

    try {
      const resolveSession = makeResolveSession(store, null);
      const resolved = await resolveSession("mode.default");
      if ("error" in resolved) throw new Error(`expected session context, got ${resolved.error}`);

      const outcome = await resolved.deps.injector.inject("hello", null, {
        app: null,
        windowTitle: null,
        controlType: null,
      });

      expect(outcome).toEqual({
        kind: "manual_copy_required",
        reason: "native_unavailable",
      });
      resolved.dispose?.();
    } finally {
      runtimeGlobal.fetch = originalFetch;
    }
  });
});
