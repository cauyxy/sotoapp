import { describe, expect, it, vi } from "vitest";
import type {
  AxContext,
  DictionaryEntry,
  HistoryRecord,
  InjectionOutcome,
} from "../../contract/schema.js";
import { assembleModelInput } from "../../capabilities/model-input/assembler.js";
import { buildAppContext } from "../../capabilities/context/appContext.js";
import type {
  ModelInput,
  ModelOutput,
} from "../../capabilities/model-input/modelInput.js";
import type { ModelRuntime } from "../../capabilities/model-runtime/runtime.js";
import type { PostInsertObserverRequest } from "../../capabilities/observation/postInsertObserver.js";
import type {
  AppContext,
  TargetContextSnapshot,
} from "../../capabilities/context/context.js";
import {
  isSameApp,
  runVoiceSession,
  type AppInfo,
  type CapturedRecording,
  type HistorySink,
  type Injector,
  type VoiceSessionInjectionPrepared,
  type VoiceSessionDeps,
  type VoiceSessionInput,
} from "./runVoiceSession.js";

function deps(captured: { record?: unknown }): VoiceSessionDeps {
  return {
    modelRuntime: {
      respond: async () => ({
        rawText: "hi",
        finalText: "hi",
        providerTrace: {
          recognitionProviderId: "p",
          recognitionModelId: null,
          llmProviderId: null,
          llmModelId: null,
        },
      }),
    },
    injector: { inject: async () => ({ kind: "paste_sent" }) },
    history: { append: async (r) => { captured.record = r; } },
    dictionary: { readDictionary: async () => [] },
    now: () => 1000,
    uuid: () => "u",
    historyEnabled: true,
  };
}

describe("runVoiceSession target_app_name", () => {
  it("stores the saved app's localized name when metadata is enabled", async () => {
    const captured: { record?: any } = {};
    const input = makeInput({
      savedApp: { pid: 7, bundleId: "com.apple.Notes", localizedName: "Notes" },
      axContextAtStart: null,
      target: { app: "com.apple.Notes", windowTitle: null, controlType: null },
      recording: { audioB64: "x", audioFormat: "wav", durationMs: 1000, peak: 0.5, voicedMs: 1000 },
      modeId: "default",
      modePrompt: "",
    });
    await runVoiceSession(deps(captured), input);
    expect(captured.record.target_app_name).toBe("Notes");
  });
});

describe("isSameApp", () => {
  it("does not match native no-app or error sentinel pids", () => {
    expect(
      isSameApp(
        { pid: 0, localizedName: "Unknown" },
        { pid: 0, localizedName: "Unknown" },
      ),
    ).toBe(false);
    expect(
      isSameApp(
        { pid: -100, localizedName: "Unknown" },
        { pid: -100, localizedName: "Unknown" },
      ),
    ).toBe(false);
  });

  it("matches positive pids when bundle ids are unavailable", () => {
    expect(
      isSameApp(
        { pid: 42, localizedName: "Editor" },
        { pid: 42, localizedName: "Editor" },
      ),
    ).toBe(true);
  });
});

const APP_A: AppInfo = { pid: 1, bundleId: "com.app.a", localizedName: "App A" };

const AX_WITH_CONTEXT: AxContext = {
  full_text: "abc",
  selection_start: 1,
  selection_end: 1,
  before: "a",
  after: "bc",
  ax_role: "AXTextArea",
  app_bundle_id: "com.app.a",
  app_name: "App A",
  window_title: "Doc",
  web_url: "https://mail.google.com/mail/u/0/#inbox",
  web_domain: "mail.google.com",
};
const ASSEMBLED_AX_CONTEXT: AxContext = {
  ...AX_WITH_CONTEXT,
  before: "assembled before",
  after: "assembled after",
  app_name: "Assembler",
  window_title: "Assembler Window",
  web_url: null,
  web_domain: "assembled.example",
};

function goodRecording(over: Partial<CapturedRecording> = {}): CapturedRecording {
  return {
    audioB64: "ZmFrZQ==",
    audioFormat: "wav",
    durationMs: 1500,
    peak: 0.5,
    voicedMs: 1000,
    ...over,
  };
}

function makeDeps(over: Partial<VoiceSessionDeps> = {}): {
  deps: VoiceSessionDeps;
  respond: ReturnType<typeof vi.fn>;
  inject: ReturnType<typeof vi.fn>;
  append: ReturnType<typeof vi.fn>;
} {
  const respond = vi.fn(
    async (): Promise<ModelOutput> => ({
      rawText: "hello world",
      finalText: "hello world",
      providerTrace: {
        recognitionProviderId: "mimo-api",
        recognitionModelId: "mimo-v2.5",
        llmProviderId: null,
        llmModelId: null,
      },
    }),
  );
  const inject = vi.fn(
    async (): Promise<InjectionOutcome> => ({ kind: "paste_sent" }),
  );
  const append = vi.fn(async () => {});

  const modelRuntime: ModelRuntime = { respond };
  const injector: Injector = { inject };
  const history: HistorySink = { append };
  const dictionary: DictionaryEntry[] = [];

  const deps: VoiceSessionDeps = {
    modelRuntime,
    injector,
    history,
    dictionary: { readDictionary: async () => dictionary },
    now: () => 1_000,
    uuid: () => "uuid-1",
    historyEnabled: true,
    ...over,
  };
  return { deps, respond, inject, append };
}

function makeInput(over: Partial<VoiceSessionInput> = {}): VoiceSessionInput {
  const { appContext, snapshot, ...rest } = over;
  const input = {
    modeId: "mode.default",
    modePrompt: "Transcribe this.",
    recording: goodRecording(),
    savedApp: APP_A,
    axContextAtStart: null,
    target: { app: "com.app.a", windowTitle: "Doc", controlType: "TextArea" },
    ...rest,
  } satisfies Omit<VoiceSessionInput, "appContext" | "snapshot">;
  const resolvedSnapshot = snapshot ?? snapshotFromInput(input);
  return {
    ...input,
    snapshot: resolvedSnapshot,
    appContext: appContext ?? appContextForSnapshot(resolvedSnapshot),
  };
}

function snapshotFromInput(input: {
  savedApp: AppInfo | null;
  axContextAtStart: AxContext | null;
  target: VoiceSessionInput["target"];
}): TargetContextSnapshot {
  const ax = input.axContextAtStart;
  const selectedText =
    ax === null ? "" : ax.full_text.slice(ax.selection_start, ax.selection_end);
  const axRole = ax?.ax_role ?? input.target.controlType ?? null;
  return {
    id: "target.default",
    capturedAt: 1000,
    reason: "voice_session_start",
    platform: "macos",
    app: {
      pid: input.savedApp?.pid ?? null,
      bundleId:
        input.savedApp?.bundleId ?? ax?.app_bundle_id ?? input.target.app ?? null,
      localizedName: input.savedApp?.localizedName ?? ax?.app_name ?? null,
      executableName: null,
    },
    window: { title: input.target.windowTitle ?? ax?.window_title ?? null },
    ax,
    focusedElement:
      axRole === null
        ? null
        : {
            axRole,
            isSecureTextEntry: null,
            bounds: null,
            valueSignature: null,
          },
    selection:
      selectedText.length > 0
        ? { text: selectedText, source: "ax_selection", confidence: "high" }
        : { text: "", source: "none", confidence: "low" },
    ambientClipboard: null,
  };
}

function appContextForSnapshot(
  snapshot: TargetContextSnapshot,
  includeWindowContextInRequests = true,
): AppContext {
  return buildAppContext({
    target: snapshot,
    settings: {
      includeWindowContextInRequests,
      clipboardContextInRequests: "off",
    },
  });
}

function targetSnapshot(
  over: Partial<TargetContextSnapshot> = {},
): TargetContextSnapshot {
  const snapshot: TargetContextSnapshot = {
    id: "target.prebuilt",
    capturedAt: 999,
    reason: "voice_session_start",
    platform: "macos",
    app: {
      pid: APP_A.pid,
      bundleId: APP_A.bundleId ?? null,
      localizedName: "Prebuilt App",
      executableName: null,
    },
    window: { title: "Prebuilt Window" },
    ax: {
      ...AX_WITH_CONTEXT,
      app_name: "Prebuilt App",
      window_title: "Prebuilt Window",
    },
    focusedElement: {
      axRole: "AXTextArea",
      isSecureTextEntry: null,
      bounds: null,
      valueSignature: null,
    },
    selection: { text: "", source: "none", confidence: "low" },
    ambientClipboard: null,
  };
  return { ...snapshot, ...over };
}

function prebuiltContext(input: {
  snapshot: TargetContextSnapshot;
  appContext: AppContext;
}): VoiceSessionInput & {
  snapshot: TargetContextSnapshot;
  appContext: AppContext;
} {
  return {
    ...makeInput({
      axContextAtStart: {
        ...AX_WITH_CONTEXT,
        app_name: "Stale App",
        window_title: "Stale Window",
      },
    }),
    snapshot: input.snapshot,
    appContext: input.appContext,
  };
}

describe("runVoiceSession", () => {
  it("returns empty(too_short) without transcribing when under MIN_RECORDING_MS", async () => {
    const { deps, respond, inject, append } = makeDeps();
    const out = await runVoiceSession(
      deps,
      makeInput({ recording: goodRecording({ durationMs: 100 }) }),
    );

    expect(out.status).toBe("empty");
    expect(out.emptyReason).toBe("too_short");
    expect(out.historyId).toBe("");
    expect(out.injectionOutcome).toEqual({ kind: "no_op" });
    expect(respond).not.toHaveBeenCalled();
    expect(inject).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });

  it("returns empty(silent) without transcribing when peak below threshold", async () => {
    const { deps, respond, inject } = makeDeps();
    const out = await runVoiceSession(
      deps,
      makeInput({ recording: goodRecording({ peak: 0.001 }) }),
    );

    expect(out.status).toBe("empty");
    expect(out.emptyReason).toBe("silent");
    expect(respond).not.toHaveBeenCalled();
    expect(inject).not.toHaveBeenCalled();
  });

  it("happy path: transcribes, injects, appends history, completed", async () => {
    const { deps, respond, inject, append } = makeDeps();
    const out = await runVoiceSession(deps, makeInput());

    expect(respond).toHaveBeenCalledOnce();
    expect(inject).toHaveBeenCalledOnce();
    expect(inject.mock.calls[0]![0]).toBe("hello world");
    expect(inject.mock.calls[0]![1]).toEqual(APP_A); // savedApp passed to injector
    expect(append).toHaveBeenCalledOnce();

    expect(out.status).toBe("completed");
    expect(out.emptyReason).toBeNull();
    expect(out.rawText).toBe("hello world");
    expect(out.finalText).toBe("hello world");
    expect(out.processedText).toBeNull(); // raw === final
    expect(out.injectionOutcome).toEqual({ kind: "paste_sent" });

    const record = append.mock.calls[0]![0] as HistoryRecord;
    expect(out.historyId).toBe(record.id);
    expect(record.id).toMatch(/^history\./);
    expect(record.mode_id).toBe("mode.default");
    expect(record.char_count).toBe([..."hello world"].length);
    expect(record.status).toBe("completed");
    expect(record.speaking_duration_ms).toBe(1500n);
    expect(record.target_app).toBe("com.app.a");
    expect(record.target_window_title).toBe("Doc");
    // History reflects the recognition provider/model the model runtime reported.
    expect(record.provider_id).toBe("mimo-api");
    expect(record.model_id).toBe("mimo-v2.5");
  });

  it("runs beforeInject with final text and waits before native insertion", async () => {
    let releaseHook: () => void = () => {};
    const hookGate = new Promise<void>((resolve) => {
      releaseHook = resolve;
    });
    let hookStarted: (prepared: VoiceSessionInjectionPrepared) => void = () => {};
    const hookStartedPromise = new Promise<VoiceSessionInjectionPrepared>((resolve) => {
      hookStarted = resolve;
    });
    const { deps, inject, append } = makeDeps({
      beforeInject: async (prepared) => {
        hookStarted(prepared);
        await hookGate;
      },
    });

    const pending = runVoiceSession(deps, makeInput());
    const prepared = await hookStartedPromise;

    expect(prepared).toMatchObject({
      modeId: "mode.default",
      rawText: "hello world",
      processedText: null,
      finalText: "hello world",
      savedApp: APP_A,
      target: { app: "com.app.a", windowTitle: "Doc", controlType: "TextArea" },
      command: false,
    });
    expect(inject).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();

    releaseHook();
    const out = await pending;

    expect(out.status).toBe("completed");
    expect(inject).toHaveBeenCalledOnce();
    expect(append).toHaveBeenCalledOnce();
  });

  it("threads the model runtime's recognition provider_id/model_id onto history (not a hardcoded value)", async () => {
    const { deps, append } = makeDeps({
      modelRuntime: {
        respond: vi.fn(
          async (): Promise<ModelOutput> => ({
            rawText: "hello world",
            finalText: "hello world",
            providerTrace: {
              recognitionProviderId: "doubao-ark",
              recognitionModelId: "doubao-1.5-pro",
              llmProviderId: null,
              llmModelId: null,
            },
          }),
        ),
      },
    });
    await runVoiceSession(deps, makeInput());

    const record = append.mock.calls[0]![0] as HistoryRecord;
    expect(record.provider_id).toBe("doubao-ark");
    expect(record.model_id).toBe("doubao-1.5-pro");
  });

  it("carries a null model_id from the port through to history", async () => {
    const { deps, append } = makeDeps({
      modelRuntime: {
        respond: vi.fn(
          async (): Promise<ModelOutput> => ({
            rawText: "hello world",
            finalText: "hello world",
            providerTrace: {
              recognitionProviderId: "some-provider",
              recognitionModelId: null,
              llmProviderId: null,
              llmModelId: null,
            },
          }),
        ),
      },
    });
    await runVoiceSession(deps, makeInput());

    const record = append.mock.calls[0]![0] as HistoryRecord;
    expect(record.provider_id).toBe("some-provider");
    expect(record.model_id).toBeNull();
  });

  it("records processed_text when the provider's final text differs from raw", async () => {
    const { deps, append } = makeDeps({
      modelRuntime: {
        respond: vi.fn(
          async (): Promise<ModelOutput> => ({
            rawText: "hello world",
            finalText: "Hello, world.",
            providerTrace: {
              recognitionProviderId: "mimo-api",
              recognitionModelId: "mimo-v2.5",
              llmProviderId: null,
              llmModelId: null,
            },
          }),
        ),
      },
    });
    const out = await runVoiceSession(deps, makeInput());

    expect(out.rawText).toBe("hello world");
    expect(out.finalText).toBe("Hello, world.");
    expect(out.processedText).toBe("Hello, world.");
    const record = append.mock.calls[0]![0] as HistoryRecord;
    expect(record.processed_text).toBe("Hello, world.");
    expect(record.injected_text).toBe("Hello, world.");
  });

  it("removes the trailing Chinese full stop from short single-line final text only", async () => {
    const cases = [
      { finalText: "今天去开会。", expected: "今天去开会" },
      { finalText: `第一行。\n第二行。`, expected: `第一行。\n第二行。` },
      { finalText: `${"字".repeat(79)}。`, expected: `${"字".repeat(79)}。` },
    ];

    for (const item of cases) {
      const { deps, inject, append } = makeDeps({
        modelRuntime: {
          respond: vi.fn(
            async (): Promise<ModelOutput> => ({
              rawText: item.finalText,
              finalText: item.finalText,
              providerTrace: {
                recognitionProviderId: "mimo-api",
                recognitionModelId: "mimo-v2.5",
                llmProviderId: null,
                llmModelId: null,
              },
            }),
          ),
        },
      });

      const out = await runVoiceSession(deps, makeInput());
      const record = append.mock.calls[0]![0] as HistoryRecord;

      expect(out.finalText).toBe(item.expected);
      expect(inject.mock.calls[0]![0]).toBe(item.expected);
      expect(record.injected_text).toBe(item.expected);
    }
  });

  it("assembles active hotwords only from dictionary entries", async () => {
    const dictionary: DictionaryEntry[] = [
      {
        id: "dict.manual",
        term: "ManualTerm",
        source: "user_added",
        hit_count: 0,
        last_used_at: null,
        created_at: 1n,
      },
    ];
    let observedHotwords: readonly string[] = [];
    const { deps } = makeDeps({
      dictionary: { readDictionary: async () => dictionary },
      modelRuntime: {
        respond: async (input: ModelInput): Promise<ModelOutput> => {
          observedHotwords = input.hotwords;
          return {
            rawText: "hello",
            finalText: "hello",
            providerTrace: {
              recognitionProviderId: "mimo-api",
              recognitionModelId: "mimo-v2.5",
              llmProviderId: null,
              llmModelId: null,
            },
          };
        },
      },
    });

    await runVoiceSession(deps, makeInput());

    expect(observedHotwords).toEqual(["ManualTerm"]);
  });

  it("routes live dictation through ModelInputAssembler before ModelRuntime", async () => {
    const modelInputAssembler = {
      assemble: vi.fn((request): ModelInput => {
        const assembled = assembleModelInput(request);
        return {
          ...assembled,
          mode: { ...assembled.mode, prompt: "assembled prompt" },
          audio: { audioB64: "assembled-audio", audioFormat: "flac" },
          hotwords: ["assembled-hotword"],
          contextBlocks: [
            { kind: "base_instruction", prompt: "assembled prompt" },
            { kind: "hotwords", hotwords: ["assembled-hotword"] },
            { kind: "target_context", axContext: ASSEMBLED_AX_CONTEXT },
            {
              kind: "user_message",
              message: {
                kind: "audio",
                audio: { audioB64: "assembled-audio", audioFormat: "flac" },
              },
            },
          ],
        };
      }),
    };
    const { deps, respond } = makeDeps({ modelInputAssembler });
    await runVoiceSession(deps, makeInput({ axContextAtStart: AX_WITH_CONTEXT }));

    expect(modelInputAssembler.assemble).toHaveBeenCalledOnce();
    expect(modelInputAssembler.assemble.mock.calls[0]![0]).toMatchObject({
      intent: "dictation",
      modeId: "mode.default",
      modePrompt: "Transcribe this.",
      appContext: {
        identity: {
          bundleId: "com.app.a",
          localizedName: "App A",
          windowTitle: "Doc",
          webDomain: "mail.google.com",
        },
      },
    });
    const input = respond.mock.calls[0]![0] as ModelInput;
    expect(input.mode.prompt).toBe("assembled prompt");
    expect(input.hotwords).toEqual(["assembled-hotword"]);
    expect(input.contextBlocks).toContainEqual({
      kind: "target_context",
      axContext: ASSEMBLED_AX_CONTEXT,
    });
    expect(input.audio).toEqual({
      audioB64: "assembled-audio",
      audioFormat: "flac",
    });
  });

  it("uses the prebuilt appContext and snapshot instead of rebuilding target context", async () => {
    const snapshot = targetSnapshot();
    const appContext = buildAppContext({
      target: snapshot,
      settings: {
        includeWindowContextInRequests: true,
        clipboardContextInRequests: "off",
      },
    });
    const { deps, respond, append } = makeDeps();

    await runVoiceSession(deps, prebuiltContext({ snapshot, appContext }));

    const modelInput = respond.mock.calls[0]![0] as ModelInput;
    expect(modelInput.contextBlocks).toContainEqual({
      kind: "target_context",
      axContext: expect.objectContaining({
        app_name: "Prebuilt App",
        window_title: "Prebuilt Window",
      }),
    });
    const record = append.mock.calls[0]![0] as HistoryRecord;
    expect(record.ax_context_at_start).toMatchObject({
      app_name: "Prebuilt App",
      window_title: "Prebuilt Window",
    });
  });

  it("strips window and web context before the model request when the request privacy setting is off", async () => {
    const voiceInput = makeInput({ axContextAtStart: AX_WITH_CONTEXT });
    const { deps, respond } = makeDeps();
    await runVoiceSession(deps, {
      ...voiceInput,
      appContext: appContextForSnapshot(voiceInput.snapshot, false),
    });

    const input = respond.mock.calls[0]![0] as ModelInput;
    expect(input.contextBlocks).toContainEqual({
      kind: "target_context",
      axContext: {
        ...AX_WITH_CONTEXT,
        app_name: null,
        window_title: null,
        web_url: null,
        web_domain: null,
      },
    });
  });

  it("never persists full web URLs and always records local target metadata", async () => {
    const first = makeDeps();
    await runVoiceSession(first.deps, makeInput({ axContextAtStart: AX_WITH_CONTEXT }));
    const stored = first.append.mock.calls[0]![0] as HistoryRecord;
    expect(stored.target_app).toBe("com.app.a");
    expect(stored.target_app_name).toBe("App A");
    expect(stored.target_window_title).toBe("Doc");
    expect(stored.target_control_type).toBe("TextArea");
    expect(stored.ax_context_at_start).toMatchObject({
      app_name: "App A",
      window_title: "Doc",
      web_url: null,
      web_domain: "mail.google.com",
    });
  });

  it("stamps llm provenance onto history when the model runtime returns it", async () => {
    const respond = vi.fn(
      async (_input: ModelInput): Promise<ModelOutput> => ({
        rawText: "hello world",
        finalText: "Hello, world.",
        providerTrace: {
          recognitionProviderId: "openai-compat",
          recognitionModelId: "whisper-1",
          llmProviderId: "openai-compat",
          llmModelId: "gpt-4o-mini",
        },
      }),
    );
    const { deps, append } = makeDeps({ modelRuntime: { respond } });
    await runVoiceSession(deps, makeInput());

    const record = append.mock.calls[0]![0] as HistoryRecord;
    expect(record.llm_provider_id).toBe("openai-compat");
    expect(record.llm_model_id).toBe("gpt-4o-mini");
  });

  it("focus-lost outcome from the injector classifies the session as failed and is recorded", async () => {
    // Focus protection lives in the injector (Rust parity); the orchestrator
    // just records whatever outcome the injector returns.
    const focusLost: InjectionOutcome = {
      kind: "focus_lost",
      detail: { saved_app_name: "App A", actual_app_name: "App B" },
    };
    const inject = vi.fn(async () => focusLost);
    const { deps, append } = makeDeps({ injector: { inject } });
    const out = await runVoiceSession(deps, makeInput());

    expect(inject).toHaveBeenCalledOnce(); // injector decides focus loss
    expect(out.status).toBe("failed");
    expect(out.injectionOutcome).toEqual(focusLost);
    expect(append).toHaveBeenCalledOnce();
    const record = append.mock.calls[0]![0] as HistoryRecord;
    expect(record.status).toBe("failed");
    expect(record.injection_outcome.kind).toBe("focus_lost");
  });

  it("model runtime throws -> error propagates to the caller", async () => {
    const { deps } = makeDeps({
      modelRuntime: {
        respond: vi.fn(async () => {
          throw new Error("model exploded");
        }),
      },
    });
    await expect(runVoiceSession(deps, makeInput())).rejects.toThrow(
      /model exploded/,
    );
  });

  it("empty model output -> empty/no_recognition, no inject, no history", async () => {
    const { deps, inject, append } = makeDeps({
      modelRuntime: {
        respond: vi.fn(
          async (): Promise<ModelOutput> => ({
            rawText: "   ",
            finalText: "   ",
            providerTrace: {
              recognitionProviderId: "mimo-api",
              recognitionModelId: "mimo-v2.5",
              llmProviderId: null,
              llmModelId: null,
            },
          }),
        ),
      },
    });
    const out = await runVoiceSession(deps, makeInput());

    expect(inject).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    expect(out.status).toBe("empty");
    expect(out.emptyReason).toBe("no_recognition");
    expect(out.historyId).toBe("");
  });

  it("history disabled: completes + injects but skips append", async () => {
    const { deps, inject, append } = makeDeps({ historyEnabled: false });
    const out = await runVoiceSession(deps, makeInput());

    expect(inject).toHaveBeenCalledOnce();
    expect(append).not.toHaveBeenCalled();
    expect(out.status).toBe("completed");
  });

  it("starts post-insert observation after history append succeeds", async () => {
    const order: string[] = [];
    const requests: PostInsertObserverRequest[] = [];
    const start = vi.fn((request: PostInsertObserverRequest) => {
      requests.push(request);
      order.push("observe");
      return { cancel: vi.fn() };
    });
    const { deps, append } = makeDeps({
      history: {
        append: async (record) => {
          order.push(`append:${record.id}`);
        },
      },
      postInsertObserver: { start },
      postInsertObservationTimeoutMs: 1234,
    });

    const out = await runVoiceSession(
      deps,
      makeInput({ sessionId: "session.1", axContextAtStart: AX_WITH_CONTEXT }),
    );

    expect(append).not.toHaveBeenCalled();
    expect(out.historyId).toBe("history.uuid-1");
    expect(order).toEqual(["append:history.uuid-1", "observe"]);
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        historyId: "history.uuid-1",
        sessionId: "session.1",
        injectedText: "hello world",
        startedAt: 1000,
        timeoutMs: 1234,
      }),
    );
    const request = requests[0]!;
    expect(request.target.reason).toBe("post_insert_observation");
    expect(request.target.ax?.app_name).toBe("App A");
  });

  it("does not start post-insert observation when history is disabled", async () => {
    const start = vi.fn(() => ({ cancel: vi.fn() }));
    const { deps, append } = makeDeps({
      historyEnabled: false,
      postInsertObserver: { start },
    });

    const out = await runVoiceSession(deps, makeInput({ sessionId: "session.1" }));

    expect(out.status).toBe("completed");
    expect(append).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it("passes a null savedApp through to the injector unchanged", async () => {
    const { deps, inject } = makeDeps();
    const out = await runVoiceSession(deps, makeInput({ savedApp: null }));
    expect(inject).toHaveBeenCalledOnce();
    expect(inject.mock.calls[0]![1]).toBeNull();
    expect(out.status).toBe("completed");
  });
});
