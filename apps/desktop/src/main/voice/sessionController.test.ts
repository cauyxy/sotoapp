import { describe, expect, it, vi } from "vitest";
import type {
  AppInfo,
  AxContext,
  CaptureControlEvent,
  InjectionOutcome,
  ModelInput,
  ModelOutput,
  VoiceRuntimeEvent,
  VoiceSessionDeps,
} from "@soto/core";
import {
  SessionController,
  type SessionContext,
  type SessionControllerPorts,
} from "./sessionController.js";

// ---- shared AX fixtures used by session context tests ----
const selAx: AxContext = {
  full_text: "hello world",
  selection_start: 6,
  selection_end: 11,
  before: "hello ",
  after: "",
  ax_role: "AXTextArea",
  app_bundle_id: "com.apple.Notes",
  app_name: "Notes",
  window_title: "Quick update - Notes",
  web_url: "https://mail.google.com/mail/u/0/#inbox",
  web_domain: "mail.google.com",
};
const noSelAx: AxContext = { ...selAx, selection_start: 0, selection_end: 0 };

// A minimal in-memory VoiceSessionDeps so runVoiceSession runs purely (no IO).
// modelRuntime returns a fixed result; injector reports `paste_sent`; history is
// captured into an array; dictionary is empty.
function fakeDeps(
  over: {
    modelOutput?: ModelOutput;
    modelError?: Error;
    historyEnabled?: boolean;
    injectionOutcome?: InjectionOutcome;
  } = {},
): { deps: VoiceSessionDeps; appended: unknown[] } {
  const appended: unknown[] = [];
  const deps: VoiceSessionDeps = {
    modelRuntime: {
      respond: async () => {
        if (over.modelError) throw over.modelError;
        return (
          over.modelOutput ?? {
            rawText: "hello world",
            finalText: "hello world",
            providerTrace: {
              recognitionProviderId: "doubao-ark",
              recognitionModelId: "doubao-1.5-pro",
              llmProviderId: null,
              llmModelId: null,
            },
          }
        );
      },
    },
    injector: { inject: async () => over.injectionOutcome ?? { kind: "paste_sent" } },
    history: { append: async (r) => void appended.push(r) },
    dictionary: { readDictionary: async () => [] },
    now: () => 1_700_000_000_000,
    uuid: () => "fixed-uuid",
    historyEnabled: over.historyEnabled ?? true,
  };
  return { deps, appended };
}

interface Harness {
  controller: SessionController;
  events: VoiceRuntimeEvent[];
  captureControl: CaptureControlEvent[];
  /** setCapsuleVisible(visible) calls, in order (true=show, false=hide). */
  capsuleVisibility: boolean[];
  /** setMediaMuted(muted) calls, in order (true=mute, false=restore). */
  mediaMuted: boolean[];
  /** expediteOverlayHide() call count (chord-dismiss consumes). */
  expedited: { count: number };
  /** onStartConsumed() call count (coordinator unwind signal). */
  consumed: { count: number };
  ports: SessionControllerPorts;
}

function harness(over: Partial<SessionControllerPorts> = {}): Harness {
  const events: VoiceRuntimeEvent[] = [];
  const captureControl: CaptureControlEvent[] = [];
  const capsuleVisibility: boolean[] = [];
  const mediaMuted: boolean[] = [];
  const expedited = { count: 0 };
  const consumed = { count: 0 };
  let counter = 0;
  const ports: SessionControllerPorts = {
    emitVoiceRuntime: (e) => events.push(e),
    sendCaptureControl: (e) => captureControl.push(e),
    setCapsuleVisible: (v) => capsuleVisibility.push(v),
    setMediaMuted: (m) => mediaMuted.push(m),
    frontmostApp: (): AppInfo => ({ pid: 42, bundleId: "com.target", localizedName: "Target" }),
    captureAxContext: (): AxContext | null => null,
    probeFocus: () => "editable",
    includeWindowContextInRequests: () => true,
    resolveSession: async (): Promise<SessionContext> => ({
      modePrompt: "be concise",
      deps: fakeDeps().deps,
    }),
    modeName: () => "Default",
    uuid: () => `sess-${++counter}`,
    micDeviceId: () => null,
    thinkingFloorMs: 0,
    insertionSettleMs: () => 0,
    isOverlayLingering: () => true,
    expediteOverlayHide: () => {
      expedited.count += 1;
    },
    onStartConsumed: () => {
      consumed.count += 1;
    },
    ...over,
  };
  return {
    controller: new SessionController(ports),
    events,
    captureControl,
    capsuleVisibility,
    mediaMuted,
    expedited,
    consumed,
    ports,
  };
}

const kinds = (events: VoiceRuntimeEvent[]) => events.map((e) => e.kind);

describe("SessionController press-to-record latency", () => {
  it("sends begin and started before target context resolves", async () => {
    let resolveFocus!: (value: "editable") => void;
    const focusPromise = new Promise<"editable">((resolve) => {
      resolveFocus = resolve;
    });
    const h = harness({
      probeFocus: () => focusPromise,
    });

    const start = h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    await Promise.resolve();

    expect(h.captureControl).toEqual([
      { kind: "begin", session_id: "sess-1", mode_id: "default", device_id: null },
    ]);
    expect(kinds(h.events)).toEqual(["started"]);
    expect(h.capsuleVisibility).toEqual([true]);

    resolveFocus("editable");
    await start;
  });

  it("keeps finished audio and waits for target context before running the session", async () => {
    let resolveFocus!: (value: "editable") => void;
    const focusPromise = new Promise<"editable">((resolve) => {
      resolveFocus = resolve;
    });
    const { deps, appended } = fakeDeps();
    const h = harness({
      probeFocus: () => focusPromise,
      resolveSession: async () => ({ modePrompt: "p", deps }),
    });

    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    await h.controller.dispatch({ kind: "finish_recording", mode_id: "default" });
    const pending = h.controller.onCaptureAudio({
      sessionId: "sess-1",
      wavBase64: "A",
      durationMs: 1500,
      peak: 0.5,
      voicedMs: 1000,
    });

    await Promise.resolve();
    expect(kinds(h.events)).toEqual(["started", "thinking"]);
    expect(appended).toEqual([]);

    resolveFocus("editable");
    await pending;

    expect(kinds(h.events)).toEqual(["started", "thinking", "inserting", "completed"]);
    expect(appended).toHaveLength(1);
  });

  it("cancels immediately while target context is still pending", async () => {
    let resolveFocus!: (value: "editable") => void;
    const focusPromise = new Promise<"editable">((resolve) => {
      resolveFocus = resolve;
    });
    const h = harness({
      probeFocus: () => focusPromise,
    });

    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    await h.controller.dispatch({ kind: "cancel_recording", mode_id: "default" });

    expect(kinds(h.events)).toEqual(["started", "cancelled"]);
    expect(h.captureControl).toEqual([
      { kind: "begin", session_id: "sess-1", mode_id: "default", device_id: null },
      { kind: "cancel", session_id: "sess-1" },
    ]);
    expect(h.controller.activeModeId()).toBeNull();

    resolveFocus("editable");
    await Promise.resolve();
    expect(kinds(h.events)).toEqual(["started", "cancelled"]);
  });
});

describe("SessionController toggle/dispatch", () => {
  it("start_recording snapshots focus, tells the renderer to begin, emits started", async () => {
    const h = harness();
    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });

    expect(h.controller.activeModeId()).toBe("default");
    expect(h.captureControl).toEqual([
      { kind: "begin", session_id: "sess-1", mode_id: "default", device_id: null },
    ]);
    expect(h.events).toEqual([
      {
        kind: "started",
        handle_id: "sess-1",
        mode_id: "default",
        status: "listening",
        mode_name: "Default",
      },
    ]);
    // Starting a session shows the capsule (no hide yet).
    expect(h.capsuleVisibility).toEqual([true]);
  });

  it("cancels active post-insert observation before a new recording starts", async () => {
    const cancelPostInsertObservation = vi.fn();
    const h = harness({ cancelPostInsertObservation });

    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });

    expect(cancelPostInsertObservation).toHaveBeenCalledOnce();
    expect(kinds(h.events)).toEqual(["started"]);
  });

  it("captures the frontmost app before showing the capsule overlay", async () => {
    const order: string[] = [];
    const h = harness({
      setCapsuleVisible: (visible) => {
        order.push(`capsule:${visible}`);
      },
      frontmostApp: () => {
        order.push("frontmostApp");
        return { pid: 42, bundleId: "com.target", localizedName: "Target" };
      },
      captureAxContext: () => {
        order.push("captureAxContext");
        return null;
      },
    });

    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });

    // frontmostApp is captured synchronously before the capsule shows; probe/AX
    // reads are deferred (safeAsync), so assert only the snapshot-before-show fact.
    expect(order).toContain("capsule:true");
    expect(order.indexOf("frontmostApp")).toBeLessThan(order.indexOf("capsule:true"));
  });

  it("merges app identity and window title into the session AX context", async () => {
    const { deps, appended } = fakeDeps();
    const h = harness({
      frontmostApp: () => ({ pid: 7, bundleId: "com.apple.Notes", localizedName: "Notes" }),
      captureAxContext: () => ({
        ...selAx,
        app_bundle_id: null,
        app_name: null,
        window_title: null,
        web_url: null,
        web_domain: null,
      }),
      captureWindowTitle: () => "Quick update - Notes",
      resolveSession: async () => ({ modePrompt: "p", deps }),
    });

    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    await h.controller.dispatch({ kind: "finish_recording", mode_id: "default" });
    await h.controller.onCaptureAudio({
      sessionId: "sess-1",
      wavBase64: "A",
      durationMs: 1500,
      peak: 0.5,
      voicedMs: 1000,
    });

    const record = appended[0] as { target_window_title: string | null; ax_context_at_start: AxContext };
    expect(record.target_window_title).toBe("Quick update - Notes");
    expect(record.ax_context_at_start).toMatchObject({
      app_bundle_id: "com.apple.Notes",
      app_name: "Notes",
      window_title: "Quick update - Notes",
    });
  });

  it("keeps web context empty when recording with Accessibility-only context", async () => {
    const { deps, appended } = fakeDeps();
    const h = harness({
      frontmostApp: () => ({ pid: 7, bundleId: "com.google.Chrome", localizedName: "Chrome" }),
      captureAxContext: () => null,
      captureWindowTitle: () => "Inbox - Chrome",
      resolveSession: async () => ({ modePrompt: "p", deps }),
    });

    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    await h.controller.dispatch({ kind: "finish_recording", mode_id: "default" });
    await h.controller.onCaptureAudio({
      sessionId: "sess-1",
      wavBase64: "A",
      durationMs: 1500,
      peak: 0.5,
      voicedMs: 1000,
    });

    const record = appended[0] as { ax_context_at_start: AxContext };
    expect(record.ax_context_at_start).toMatchObject({
      app_bundle_id: "com.google.Chrome",
      app_name: "Chrome",
      window_title: "Inbox - Chrome",
      web_url: null,
      web_domain: null,
    });
  });

  it("uses the window-context privacy setting while acquiring voice context", async () => {
    const { deps } = fakeDeps();
    const respond = vi.fn(async (_input: ModelInput): Promise<ModelOutput> => ({
      rawText: "hello world",
      finalText: "hello world",
      providerTrace: {
        recognitionProviderId: "doubao-ark",
        recognitionModelId: "doubao-1.5-pro",
        llmProviderId: null,
        llmModelId: null,
      },
    }));
    deps.modelRuntime = { respond };
    const h = harness({
      includeWindowContextInRequests: () => false,
      captureAxContext: () => selAx,
      resolveSession: async () => ({ modePrompt: "p", deps }),
    });

    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    await h.controller.dispatch({ kind: "finish_recording", mode_id: "default" });
    await h.controller.onCaptureAudio({
      sessionId: "sess-1",
      wavBase64: "A",
      durationMs: 1500,
      peak: 0.5,
      voicedMs: 1000,
    });

    const modelInput = respond.mock.calls[0]![0] as ModelInput;
    expect(modelInput.contextBlocks).toContainEqual({
      kind: "target_context",
      axContext: {
        ...selAx,
        app_bundle_id: "com.target",
        app_name: null,
        window_title: null,
        web_url: null,
        web_domain: null,
      },
    });
  });

  it("a second start while active is ignored (no second begin/started)", async () => {
    const h = harness();
    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    expect(h.captureControl).toHaveLength(1);
    expect(kinds(h.events)).toEqual(["started"]);
  });

  it("finish_recording emits thinking but does NOT run the session yet", async () => {
    const h = harness();
    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    h.events.length = 0;
    await h.controller.dispatch({ kind: "finish_recording", mode_id: "default" });
    expect(kinds(h.events)).toEqual(["thinking"]);
    // still active (awaiting the WAV); no terminal event yet.
    expect(h.controller.activeModeId()).toBe("default");
  });

  it("finish_recording tells the renderer to stop the mic + push the WAV (capture-control finish)", async () => {
    // The fix for the confirmed hang: the hotkey toggle's finish must drive the
    // capsule's finishCapture (stop+push), not just emit `thinking`.
    const h = harness();
    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    h.captureControl.length = 0;
    await h.controller.dispatch({ kind: "finish_recording", mode_id: "default" });
    expect(h.captureControl).toEqual([{ kind: "finish", session_id: "sess-1" }]);
    // The capsule stays shown until the WAV arrives + the terminal event fires.
    expect(h.capsuleVisibility).toEqual([true]);
  });

  it("full flow: start -> finish -> renderer pushes WAV -> completed", async () => {
    const { deps, appended } = fakeDeps();
    const resolveSession = vi.fn(async () => ({ modePrompt: "p", deps }));
    const h = harness({ resolveSession });

    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    await h.controller.dispatch({ kind: "finish_recording", mode_id: "default" });
    await h.controller.onCaptureAudio({
      sessionId: "sess-1",
      wavBase64: "AAA",
      durationMs: 1200,
      peak: 0.5,
      voicedMs: 1000,
    });

    expect(resolveSession).toHaveBeenCalledWith("default");
    expect(kinds(h.events)).toEqual(["started", "thinking", "inserting", "completed"]);
    const completed = h.events.at(-1)! as Extract<VoiceRuntimeEvent, { kind: "completed" }>;
    expect(completed.raw_text).toBe("hello world");
    expect(completed.final_text).toBe("hello world");
    expect(completed.status).toBe("completed");
    expect(appended).toHaveLength(1); // history persisted
    expect(h.controller.activeModeId()).toBeNull(); // session cleared
    // Capsule shown on start, hidden once the terminal event fired.
    expect(h.capsuleVisibility).toEqual([true, false]);
  });

  it("starts post-insert observation without blocking the completed event", async () => {
    const { deps } = fakeDeps();
    const observerStart = vi.fn(() => ({ cancel: vi.fn() }));
    deps.postInsertObserver = { start: observerStart };
    const h = harness({ resolveSession: async () => ({ modePrompt: "p", deps }) });

    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    await h.controller.dispatch({ kind: "finish_recording", mode_id: "default" });
    await h.controller.onCaptureAudio({
      sessionId: "sess-1",
      wavBase64: "AAA",
      durationMs: 1200,
      peak: 0.5,
      voicedMs: 1000,
    });

    expect(kinds(h.events)).toEqual(["started", "thinking", "inserting", "completed"]);
    expect(observerStart).toHaveBeenCalledWith(
      expect.objectContaining({
        historyId: "history.fixed-uuid",
        sessionId: "sess-1",
        injectedText: "hello world",
      }),
    );
  });

  it("is re-entrant: a second start/finish/push records again after the first completes", async () => {
    // Regression for the confirmed "only the first recording works" hang: once
    // onCaptureAudio clears this.active, the next start must not be dropped.
    const { deps } = fakeDeps();
    const h = harness({ resolveSession: async () => ({ modePrompt: "p", deps }) });

    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    await h.controller.dispatch({ kind: "finish_recording", mode_id: "default" });
    await h.controller.onCaptureAudio({
      sessionId: "sess-1",
      wavBase64: "A",
      durationMs: 1500,
      peak: 0.5,
      voicedMs: 1000,
    });
    expect(h.controller.activeModeId()).toBeNull();

    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    expect(h.controller.activeModeId()).toBe("default"); // NOT dropped
    expect(h.captureControl).toContainEqual({
      kind: "begin",
      session_id: "sess-2",
      mode_id: "default",
      device_id: null,
    });
    await h.controller.dispatch({ kind: "finish_recording", mode_id: "default" });
    expect(h.captureControl).toContainEqual({ kind: "finish", session_id: "sess-2" });
    await h.controller.onCaptureAudio({
      sessionId: "sess-2",
      wavBase64: "A",
      durationMs: 1500,
      peak: 0.5,
      voicedMs: 1000,
    });

    expect(kinds(h.events)).toEqual([
      "started", "thinking", "inserting", "completed", "started", "thinking", "inserting", "completed",
    ]);
    expect(h.capsuleVisibility).toEqual([true, false, true, false]);
  });

  it("cancel_recording tells the renderer to cancel and emits cancelled", async () => {
    const h = harness();
    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    h.events.length = 0;
    h.captureControl.length = 0;
    await h.controller.dispatch({ kind: "cancel_recording", mode_id: "default" });

    expect(h.captureControl).toEqual([{ kind: "cancel", session_id: "sess-1" }]);
    expect(kinds(h.events)).toEqual(["cancelled"]);
    expect(h.controller.activeModeId()).toBeNull();
    // The capsule was shown on start and hidden on the cancel.
    expect(h.capsuleVisibility).toEqual([true, false]);
  });

  it("finishActive() (capsule ✓ button) finishes like a finish_recording toggle", async () => {
    const h = harness();
    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    h.captureControl.length = 0;
    h.controller.finishActive();
    expect(h.captureControl).toEqual([{ kind: "finish", session_id: "sess-1" }]);
    expect(h.controller.activeModeId()).toBe("default"); // awaiting the WAV
  });

  it("cancelActive() (capsule ✕ button) cancels like a cancel_recording toggle", async () => {
    const h = harness();
    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    h.captureControl.length = 0;
    h.controller.cancelActive();
    expect(h.captureControl).toEqual([{ kind: "cancel", session_id: "sess-1" }]);
    expect(h.controller.activeModeId()).toBeNull();
  });

  it("finishActive()/cancelActive() are no-ops with no active session", () => {
    const h = harness();
    h.controller.finishActive();
    h.controller.cancelActive();
    expect(h.captureControl).toEqual([]);
    expect(h.events).toEqual([]);
  });

  it("noticeAction(copy_text) copies the last terminal final text", async () => {
    const copied: string[] = [];
    const { deps } = fakeDeps({
      modelOutput: {
        rawText: "copy this result",
        finalText: "copy this result",
        providerTrace: {
          recognitionProviderId: "p",
          recognitionModelId: "m",
          llmProviderId: null,
          llmModelId: null,
        },
      },
    });
    const h = harness({
      copyNoticeText: (text) => copied.push(text),
      resolveSession: async () => ({ modePrompt: "p", deps }),
    });

    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    await h.controller.dispatch({ kind: "finish_recording", mode_id: "default" });
    await h.controller.onCaptureAudio({
      sessionId: "sess-1",
      wavBase64: "A",
      durationMs: 1200,
      peak: 0.5,
      voicedMs: 1000,
    });
    h.controller.noticeAction("copy_text");

    expect(copied).toEqual(["copy this result"]);
  });

  it("noticeAction(open_permission_settings) opens Accessibility settings", () => {
    const opened = { count: 0 };
    const h = harness({
      openAccessibilitySettings: () => {
        opened.count += 1;
      },
    });

    h.controller.noticeAction("open_permission_settings");

    expect(opened.count).toBe(1);
  });
});

describe("SessionController capture correlation", () => {
  it("ignores a WAV push for a non-matching session id", async () => {
    const resolveSession = vi.fn(async () => ({ modePrompt: "p", deps: fakeDeps().deps }));
    const h = harness({ resolveSession });
    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    await h.controller.dispatch({ kind: "finish_recording", mode_id: "default" });

    await h.controller.onCaptureAudio({
      sessionId: "stale-999",
      wavBase64: "AAA",
      durationMs: 1200,
      peak: 0.5,
      voicedMs: 1000,
    });
    expect(resolveSession).not.toHaveBeenCalled();
    expect(kinds(h.events)).toEqual(["started", "thinking"]); // no terminal event
  });

  it("ignores a duplicate WAV push (session cleared after the first)", async () => {
    const resolveSession = vi.fn(async () => ({ modePrompt: "p", deps: fakeDeps().deps }));
    const h = harness({ resolveSession });
    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    await h.controller.dispatch({ kind: "finish_recording", mode_id: "default" });
    await h.controller.onCaptureAudio({ sessionId: "sess-1", wavBase64: "A", durationMs: 1200, peak: 0.5, voicedMs: 1000 });
    await h.controller.onCaptureAudio({ sessionId: "sess-1", wavBase64: "A", durationMs: 1200, peak: 0.5, voicedMs: 1000 });
    expect(resolveSession).toHaveBeenCalledTimes(1);
  });

  it("relays a level frame as a scaled level event (0..65535)", async () => {
    const h = harness();
    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    h.events.length = 0;
    h.controller.onCaptureLevel("sess-1", 0.5);
    expect(h.events).toEqual([{ kind: "level", rms: 32768, peak: 32768 }]);
  });

  it("drops a level frame for the wrong session", async () => {
    const h = harness();
    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    h.events.length = 0;
    h.controller.onCaptureLevel("other", 0.5);
    expect(h.events).toEqual([]);
  });

  it("clamps level frames to the wire range", async () => {
    const h = harness();
    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    h.events.length = 0;
    h.controller.onCaptureLevel("sess-1", 5);
    h.controller.onCaptureLevel("sess-1", -1);
    expect(h.events).toEqual([
      { kind: "level", rms: 65535, peak: 65535 },
      { kind: "level", rms: 0, peak: 0 },
    ]);
  });
});

describe("SessionController error paths", () => {
  it("emits missing_provider when no session context can be resolved", async () => {
    const h = harness({ resolveSession: async () => ({ error: "missing_provider" as const }) });
    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    await h.controller.dispatch({ kind: "finish_recording", mode_id: "default" });
    await h.controller.onCaptureAudio({ sessionId: "sess-1", wavBase64: "A", durationMs: 1200, peak: 0.5, voicedMs: 1000 });

    const last = h.events.at(-1)! as Extract<VoiceRuntimeEvent, { kind: "error" }>;
    expect(last.kind).toBe("error");
    expect(last.code).toBe("missing_provider");
    expect(h.controller.activeModeId()).toBeNull();
    // The capsule is hidden on the terminal error too (show on start, hide here).
    expect(h.capsuleVisibility).toEqual([true, false]);
  });

  it("emits missing_mode when the resolver reports the mode is gone", async () => {
    const h = harness({ resolveSession: async () => ({ error: "missing_mode" as const }) });
    await h.controller.dispatch({ kind: "start_recording", mode_id: "ghost" });
    await h.controller.dispatch({ kind: "finish_recording", mode_id: "ghost" });
    await h.controller.onCaptureAudio({ sessionId: "sess-1", wavBase64: "A", durationMs: 1200, peak: 0.5, voicedMs: 1000 });

    const last = h.events.at(-1)! as Extract<VoiceRuntimeEvent, { kind: "error" }>;
    expect(last.kind).toBe("error");
    expect(last.code).toBe("missing_mode");
    expect(h.controller.activeModeId()).toBeNull();
  });

  it("emits a generic error when model runtime throws", async () => {
    const { deps } = fakeDeps({ modelError: new Error("provider exploded") });
    const h = harness({ resolveSession: async () => ({ modePrompt: "p", deps }) });
    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    await h.controller.dispatch({ kind: "finish_recording", mode_id: "default" });
    await h.controller.onCaptureAudio({ sessionId: "sess-1", wavBase64: "A", durationMs: 1200, peak: 0.5, voicedMs: 1000 });

    const last = h.events.at(-1)! as Extract<VoiceRuntimeEvent, { kind: "error" }>;
    expect(last.kind).toBe("error");
    expect(last.code).toBe("generic");
    expect(last.message).toContain("provider exploded");
  });

  it("report_capture_error fails the active session with a generic error", async () => {
    const h = harness();
    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    h.events.length = 0;
    h.captureControl.length = 0;
    await h.controller.onCaptureError("sess-1", "microphone denied");
    const last = h.events.at(-1)! as Extract<VoiceRuntimeEvent, { kind: "error" }>;
    expect(last.kind).toBe("error");
    expect(last.message).toBe("microphone denied");
    expect(h.controller.activeModeId()).toBeNull();
    // The renderer's mic is released (capture-control cancel) and the capsule hidden.
    expect(h.captureControl).toEqual([{ kind: "cancel", session_id: "sess-1" }]);
    expect(h.capsuleVisibility).toEqual([true, false]);
    // After a failure, a stale WAV push must not run anything.
    await h.controller.onCaptureAudio({ sessionId: "sess-1", wavBase64: "A", durationMs: 1200, peak: 0.5, voicedMs: 1000 });
    expect(kinds(h.events)).toEqual(["error"]);
  });

  it("empty/short recording surfaces a completed event with an empty_reason", async () => {
    const { deps } = fakeDeps();
    const h = harness({ resolveSession: async () => ({ modePrompt: "p", deps }) });
    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    await h.controller.dispatch({ kind: "finish_recording", mode_id: "default" });
    // peak 0 trips the silence gate -> empty outcome (reason "silent").
    await h.controller.onCaptureAudio({ sessionId: "sess-1", wavBase64: "A", durationMs: 1200, peak: 0, voicedMs: 0 });

    const last = h.events.at(-1)! as Extract<VoiceRuntimeEvent, { kind: "completed" }>;
    expect(last.kind).toBe("completed");
    expect(last.status).toBe("empty");
    expect(last.empty_reason).toBe("silent");
  });
});

describe("SessionController media mute", () => {
  it("mutes media on the real capture-started ack and restores on finish", async () => {
    const h = harness();
    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    // No mute yet — start_recording alone does not prove the mic opened.
    expect(h.mediaMuted).toEqual([]);
    h.controller.onCaptureStarted("sess-1");
    expect(h.mediaMuted).toEqual([true]);
    await h.controller.dispatch({ kind: "finish_recording", mode_id: "default" });
    expect(h.mediaMuted).toEqual([true, false]);
  });

  it("ignores a stale capture-started ack (no mute for a non-active session)", async () => {
    const h = harness();
    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    h.controller.onCaptureStarted("stale-session");
    expect(h.mediaMuted).toEqual([]);
  });

  it("restores media on cancel", async () => {
    const h = harness();
    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    h.controller.onCaptureStarted("sess-1");
    await h.controller.dispatch({ kind: "cancel_recording", mode_id: "default" });
    expect(h.mediaMuted).toEqual([true, false]);
  });

  it("restores media on a capture error", async () => {
    const h = harness();
    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    h.controller.onCaptureStarted("sess-1");
    await h.controller.onCaptureError("sess-1", "mic denied");
    expect(h.mediaMuted).toEqual([true, false]);
  });

  it("a late capture-started after finish does not re-mute (awaitingAudio guard)", async () => {
    const h = harness();
    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    await h.controller.dispatch({ kind: "finish_recording", mode_id: "default" });
    // finish already restored media; the ultra-late ack must not re-mute.
    h.controller.onCaptureStarted("sess-1");
    expect(h.mediaMuted).toEqual([false]);
  });
});

describe("SessionController capsule window linger (Panel readability)", () => {
  it("lingers (long hide) when a terminal implies a Panel notice — e.g. missing_provider", async () => {
    const hides: Array<{ lingerMs: number | undefined; exit: string | undefined }> = [];
    const h = harness({
      setCapsuleVisible: (visible, lingerMs, exit) => {
        if (!visible) hides.push({ lingerMs, exit });
      },
      resolveSession: async () => ({ error: "missing_provider" as const }), // → missing_provider error notice
    });
    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    await h.controller.dispatch({ kind: "finish_recording", mode_id: "default" });
    await h.controller.onCaptureAudio({ sessionId: "sess-1", wavBase64: "A", durationMs: 1, peak: 0.5, voicedMs: 1000 });
    // A sticky error notice must keep the window up well beyond the default short hide.
    expect(hides.at(-1)?.lingerMs).toBeGreaterThan(2000);
    expect(hides.at(-1)?.exit).toBe("error");
  });

  it("uses the success choreography linger after a clean success", async () => {
    const { deps } = fakeDeps();
    const hides: Array<{ lingerMs: number | undefined; exit: string | undefined }> = [];
    const h = harness({
      setCapsuleVisible: (visible, lingerMs, exit) => {
        if (!visible) hides.push({ lingerMs, exit });
      },
      resolveSession: async () => ({ modePrompt: "p", deps }),
    });
    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    await h.controller.dispatch({ kind: "finish_recording", mode_id: "default" });
    // A real-length, non-silent recording → a genuine clean insert (1ms would
    // trip the too-short gate and surface an empty-result notice instead).
    await h.controller.onCaptureAudio({ sessionId: "sess-1", wavBase64: "A", durationMs: 1200, peak: 0.5, voicedMs: 1000 });
    // Clean insert → no notice → the capsule still needs time for sprint/check/exit.
    expect(hides.at(-1)).toEqual({ lingerMs: 700, exit: "success" });
  });

  it("lingers as a notice when injection requires manual copy", async () => {
    const { deps } = fakeDeps({
      injectionOutcome: {
        kind: "manual_copy_required",
        reason: "clipboard_unrestorable",
      },
    });
    const hides: Array<{ lingerMs: number | undefined; exit: string | undefined }> = [];
    const h = harness({
      setCapsuleVisible: (visible, lingerMs, exit) => {
        if (!visible) hides.push({ lingerMs, exit });
      },
      resolveSession: async () => ({ modePrompt: "p", deps }),
    });
    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    await h.controller.dispatch({ kind: "finish_recording", mode_id: "default" });
    await h.controller.onCaptureAudio({
      sessionId: "sess-1",
      wavBase64: "A",
      durationMs: 1200,
      peak: 0.5,
      voicedMs: 1000,
    });

    expect(hides.at(-1)?.lingerMs).toBeGreaterThan(1000);
    expect(hides.at(-1)?.exit).toBe("notice");
  });

  it("lingers on a capture error so the error Panel is readable", async () => {
    const hides: Array<{ lingerMs: number | undefined; exit: string | undefined }> = [];
    const h = harness({
      setCapsuleVisible: (visible, lingerMs, exit) => {
        if (!visible) hides.push({ lingerMs, exit });
      },
    });
    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    await h.controller.onCaptureError("sess-1", "mic denied");
    expect(hides.at(-1)?.lingerMs).toBeGreaterThan(2000);
    expect(hides.at(-1)?.exit).toBe("error");
  });
});

describe("capsule visual redesign v1", () => {
  it("shows the capsule and sends begin without waiting for AX context", async () => {
    const order: string[] = [];
    const h = harness({
      setCapsuleVisible: (visible) => {
        order.push(visible ? "show" : "hide");
      },
      captureAxContext: () => {
        order.push("ax");
        return null;
      },
      sendCaptureControl: (event) => {
        order.push(event.kind === "begin" ? "begin-capture" : event.kind);
      },
    });

    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });

    expect(order.slice(0, 2)).toEqual(["show", "begin-capture"]);
  });

  it("started/thinking/inserting carry mode_name", async () => {
    const h = harness({ modeName: () => "Translate" });
    await h.controller.dispatch({ kind: "start_recording", mode_id: "translate" });
    await h.controller.dispatch({ kind: "finish_recording", mode_id: "translate" });
    await h.controller.onCaptureAudio({
      sessionId: "sess-1",
      wavBase64: "UklGRg==",
      durationMs: 1500,
      peak: 0.5,
      voicedMs: 1000,
    });
    const started = h.events.find((e) => e.kind === "started");
    const thinking = h.events.find((e) => e.kind === "thinking");
    const inserting = h.events.find((e) => e.kind === "inserting");
    expect(started).toMatchObject({ mode_name: "Translate" });
    expect(thinking).toMatchObject({ mode_name: "Translate" });
    expect(inserting).toMatchObject({ mode_name: "Translate" });
    expect(started).not.toHaveProperty("is_command");
    expect(thinking).not.toHaveProperty("is_command");
    expect(inserting).not.toHaveProperty("is_command");
  });

  it("cancel hides with the fast linger (200ms)", async () => {
    const hides: Array<{ lingerMs: number | undefined; exit: string | undefined }> = [];
    const h = harness({
      setCapsuleVisible: (v: boolean, lingerMs?: number, exit?: string) => {
        if (!v) hides.push({ lingerMs, exit });
      },
    });
    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    await h.controller.dispatch({ kind: "cancel_recording", mode_id: "default" });
    expect(hides).toEqual([{ lingerMs: 200, exit: "cancel" }]);
  });

  it("a clean success hides with the 700ms choreography linger", async () => {
    const hides: Array<{ lingerMs: number | undefined; exit: string | undefined }> = [];
    const h = harness({
      setCapsuleVisible: (v: boolean, lingerMs?: number, exit?: string) => {
        if (!v) hides.push({ lingerMs, exit });
      },
    });
    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    await h.controller.dispatch({ kind: "finish_recording", mode_id: "default" });
    await h.controller.onCaptureAudio({
      sessionId: "sess-1",
      wavBase64: "UklGRg==",
      durationMs: 1500,
      peak: 0.5,
      voicedMs: 1000,
    });
    expect(hides).toEqual([{ lingerMs: 700, exit: "success" }]);
  });

  it("emits slow events at 8s and 20s of thinking, cleared by the terminal", async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
      await h.controller.dispatch({ kind: "finish_recording", mode_id: "default" });
      vi.advanceTimersByTime(8000);
      expect(h.events.filter((e) => e.kind === "slow")).toEqual([
        { kind: "slow", mode_id: "default", elapsed_ms: 8000 },
      ]);
      vi.advanceTimersByTime(12000);
      expect(h.events.filter((e) => e.kind === "slow")).toHaveLength(2);
      await h.controller.onCaptureAudio({
        sessionId: "sess-1",
        wavBase64: "UklGRg==",
        durationMs: 1500,
        peak: 0.5,
        voicedMs: 1000,
      });
      vi.advanceTimersByTime(60000);
      expect(h.events.filter((e) => e.kind === "slow")).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("SessionController dictation-only voice flow", () => {
  it("starts recording without a selection preflight", async () => {
    const h = harness({ captureAxContext: () => noSelAx });
    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    expect(h.captureControl).toContainEqual(expect.objectContaining({ kind: "begin" }));
  });
});

describe("chord-dismiss: a press closes a lingering attention notice", () => {
  /** Drive a full record→finish→error cycle so the attention flag is set. */
  async function driveErrorCycle(h: Harness): Promise<void> {
    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    await h.controller.dispatch({ kind: "finish_recording", mode_id: "default" });
    await h.controller.onCaptureError("sess-1", "mic exploded");
    expect(kinds(h.events)).toContain("error");
  }

  it("consumes the press while the error notice lingers: no begin, no started", async () => {
    const h = harness();
    await driveErrorCycle(h);
    const beginsBefore = h.captureControl.filter((c) => c.kind === "begin").length;

    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });

    expect(h.captureControl.filter((c) => c.kind === "begin")).toHaveLength(beginsBefore);
    expect(h.events.filter((e) => e.kind === "started")).toHaveLength(1); // only the first
    expect(h.expedited.count).toBe(1);
    expect(h.consumed.count).toBe(1); // coordinator unwind requested
  });

  it("the consume clears the flag: the NEXT press records normally", async () => {
    const h = harness();
    await driveErrorCycle(h);
    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" }); // consumed
    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" }); // records

    expect(h.events.filter((e) => e.kind === "started")).toHaveLength(2);
    expect(h.expedited.count).toBe(1);
  });

  it("a stale flag (overlay already hidden) records instead of consuming", async () => {
    const h = harness({ isOverlayLingering: () => false });
    await driveErrorCycle(h);
    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });

    expect(h.events.filter((e) => e.kind === "started")).toHaveLength(2);
    expect(h.expedited.count).toBe(0);
  });

  it("a failed terminal sets attention too", async () => {
    const failingDeps = fakeDeps().deps;
    failingDeps.injector = { inject: async () => ({ kind: "failed", detail: "boom" }) };
    const h = harness({
      resolveSession: async () => ({ modePrompt: "p", deps: failingDeps }),
    });
    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    await h.controller.dispatch({ kind: "finish_recording", mode_id: "default" });
    await h.controller.onCaptureAudio({
      sessionId: "sess-1",
      wavBase64: "UklGRg==",
      durationMs: 1500,
      peak: 0.5,
      voicedMs: 1000,
    });
    expect(kinds(h.events)).toContain("failed");

    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    expect(h.events.filter((e) => e.kind === "started")).toHaveLength(1);
    expect(h.expedited.count).toBe(1);
  });

  it("benign outcomes never set attention: cancel and clean success", async () => {
    const h = harness();
    // cancel
    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    await h.controller.dispatch({ kind: "cancel_recording", mode_id: "default" });
    // clean success
    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    await h.controller.dispatch({ kind: "finish_recording", mode_id: "default" });
    await h.controller.onCaptureAudio({
      sessionId: "sess-2",
      wavBase64: "UklGRg==",
      durationMs: 1500,
      peak: 0.5,
      voicedMs: 1000,
    });
    // every subsequent press records — nothing was consumed anywhere
    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    expect(h.expedited.count).toBe(0);
    expect(h.events.filter((e) => e.kind === "started")).toHaveLength(3);
  });

  it("noticeDismissed() (Got it / strip click) clears attention", async () => {
    const h = harness();
    await driveErrorCycle(h);
    h.controller.noticeDismissed();

    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    expect(h.events.filter((e) => e.kind === "started")).toHaveLength(2);
    expect(h.expedited.count).toBe(0);
  });

  it("a started session always clears attention (error → successful retry)", async () => {
    const h = harness({ isOverlayLingering: () => false }); // stale → records
    await driveErrorCycle(h);
    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    await h.controller.dispatch({ kind: "cancel_recording", mode_id: "default" });

    // After a real session ran, the old error must not consume future presses.
    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    expect(h.expedited.count).toBe(0);
    expect(h.events.filter((e) => e.kind === "started")).toHaveLength(3);
  });
});

describe("thinking display floor (no flash on fast responses)", () => {
  it("pays the thinking floor before insertion and emits inserting before completed", async () => {
    vi.useFakeTimers();
    try {
      const { deps } = fakeDeps();
      const inject = vi.fn(async () => ({ kind: "paste_sent" as const }));
      deps.injector = { inject };
      const h = harness({
        thinkingFloorMs: 200,
        resolveSession: async () => ({ modePrompt: "p", deps }),
      });

      await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
      await h.controller.dispatch({ kind: "finish_recording", mode_id: "default" });
      const pending = h.controller.onCaptureAudio({
        sessionId: "sess-1",
        wavBase64: "UklGRg==",
        durationMs: 1500,
        peak: 0.5,
        voicedMs: 1000,
      });

      await vi.advanceTimersByTimeAsync(199);
      expect(inject).not.toHaveBeenCalled();
      expect(kinds(h.events)).not.toContain("inserting");

      await vi.advanceTimersByTimeAsync(1);
      await pending;

      expect(inject).toHaveBeenCalledOnce();
      expect(kinds(h.events)).toEqual(["started", "thinking", "inserting", "completed"]);
      expect(kinds(h.events).indexOf("inserting")).toBeLessThan(
        kinds(h.events).indexOf("completed"),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits the insertion settle before completed", async () => {
    vi.useFakeTimers();
    try {
      const h = harness({
        insertionSettleMs: () => 80,
      });
      await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
      await h.controller.dispatch({ kind: "finish_recording", mode_id: "default" });
      const pending = h.controller.onCaptureAudio({
        sessionId: "sess-1",
        wavBase64: "UklGRg==",
        durationMs: 1500,
        peak: 0.5,
        voicedMs: 1000,
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(kinds(h.events)).toContain("inserting");
      expect(kinds(h.events)).not.toContain("completed");

      await vi.advanceTimersByTimeAsync(79);
      expect(kinds(h.events)).not.toContain("completed");
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(kinds(h.events)).toContain("completed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("holds the terminal until the floor elapses; pipeline time overlaps", async () => {
    vi.useFakeTimers();
    try {
      const h = harness({ thinkingFloorMs: 200 });
      await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
      vi.advanceTimersByTime(50); // 50ms of recording
      await h.controller.dispatch({ kind: "finish_recording", mode_id: "default" });
      const pending = h.controller.onCaptureAudio({
        sessionId: "sess-1",
        wavBase64: "UklGRg==",
        durationMs: 1500,
        peak: 0.5,
        voicedMs: 1000,
      });
      // The pipeline resolves in microtasks; the floor still has ~200ms to go.
      await vi.advanceTimersByTimeAsync(199);
      expect(kinds(h.events)).not.toContain("completed");
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(kinds(h.events)).toContain("completed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a slow pipeline (≥ floor) emits immediately — no added latency", async () => {
    vi.useFakeTimers();
    try {
      let release: () => void = () => {};
      const gate = new Promise<void>((r) => (release = r));
      const h = harness({
        thinkingFloorMs: 200,
        resolveSession: async () => {
          await gate;
          return { modePrompt: "p", deps: fakeDeps().deps };
        },
      });
      await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
      await h.controller.dispatch({ kind: "finish_recording", mode_id: "default" });
      const pending = h.controller.onCaptureAudio({
        sessionId: "sess-1",
        wavBase64: "UklGRg==",
        durationMs: 1500,
        peak: 0.5,
        voicedMs: 1000,
      });
      await vi.advanceTimersByTimeAsync(500); // pipeline still gated, floor long past
      release();
      await pending; // resolves without any further timer advance
      expect(kinds(h.events)).toContain("completed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a new session during the floor supersedes the stale terminal AND its hide", async () => {
    vi.useFakeTimers();
    try {
      const { deps } = fakeDeps();
      const inject = vi.fn(async () => ({ kind: "paste_sent" as const }));
      deps.injector = { inject };
      const h = harness({
        thinkingFloorMs: 300,
        resolveSession: async () => ({ modePrompt: "p", deps }),
      });
      await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
      await h.controller.dispatch({ kind: "finish_recording", mode_id: "default" });
      const pending = h.controller.onCaptureAudio({
        sessionId: "sess-1",
        wavBase64: "UklGRg==",
        durationMs: 1500,
        peak: 0.5,
        voicedMs: 1000,
      });
      await vi.advanceTimersByTimeAsync(50);
      // User chains the next dictation while the floor is still holding.
      await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
      await vi.advanceTimersByTimeAsync(300);
      await pending;

      // The stale completed event was suppressed; the new session is intact.
      expect(kinds(h.events).filter((k) => k === "completed")).toHaveLength(0);
      expect(inject).not.toHaveBeenCalled();
      expect(kinds(h.events).filter((k) => k === "started")).toHaveLength(2);
      // And no hide was scheduled against the new session's window.
      expect(h.capsuleVisibility).toEqual([true, true]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a newer completed session supersedes an older run still waiting for target context", async () => {
    let resolveFirstFocus!: (value: "editable") => void;
    const firstFocus = new Promise<"editable">((resolve) => {
      resolveFirstFocus = resolve;
    });
    let probeCalls = 0;
    const { deps, appended } = fakeDeps();
    const resolveSession = vi.fn(async () => ({ modePrompt: "p", deps }));
    const h = harness({
      probeFocus: () => {
        probeCalls += 1;
        return probeCalls === 1 ? firstFocus : "editable";
      },
      resolveSession,
    });

    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    await h.controller.dispatch({ kind: "finish_recording", mode_id: "default" });
    const stale = h.controller.onCaptureAudio({
      sessionId: "sess-1",
      wavBase64: "UklGRg==",
      durationMs: 1500,
      peak: 0.5,
      voicedMs: 1000,
    });
    await Promise.resolve();

    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    await h.controller.dispatch({ kind: "finish_recording", mode_id: "default" });
    await h.controller.onCaptureAudio({
      sessionId: "sess-2",
      wavBase64: "UklGRg==",
      durationMs: 1500,
      peak: 0.5,
      voicedMs: 1000,
    });

    expect(resolveSession).toHaveBeenCalledTimes(1);
    expect(appended).toHaveLength(1);
    expect(kinds(h.events).filter((kind) => kind === "completed")).toHaveLength(1);

    resolveFirstFocus("editable");
    await stale;

    expect(resolveSession).toHaveBeenCalledTimes(1);
    expect(appended).toHaveLength(1);
    expect(kinds(h.events).filter((kind) => kind === "completed")).toHaveLength(1);
    expect(kinds(h.events).filter((kind) => kind === "started")).toHaveLength(2);
    expect(h.controller.activeModeId()).toBeNull();
  });

  it("a stale run does not consume a newer session's thinking floor", async () => {
    vi.useFakeTimers();
    try {
      let releaseOldModel!: () => void;
      let releaseNewModel!: () => void;
      const oldModelGate = new Promise<void>((resolve) => {
        releaseOldModel = resolve;
      });
      const newModelGate = new Promise<void>((resolve) => {
        releaseNewModel = resolve;
      });
      const flushAsyncWork = async () => {
        await vi.advanceTimersByTimeAsync(0);
        await Promise.resolve();
      };
      const { deps } = fakeDeps();
      let respondCalls = 0;
      let oldModelStarted = false;
      let newModelStarted = false;
      deps.modelRuntime = {
        respond: async () => {
          respondCalls += 1;
          if (respondCalls === 1) {
            oldModelStarted = true;
            await oldModelGate;
          } else {
            newModelStarted = true;
            await newModelGate;
          }
          return {
            rawText: "hello world",
            finalText: "hello world",
            providerTrace: {
              recognitionProviderId: "doubao-ark",
              recognitionModelId: "doubao-1.5-pro",
              llmProviderId: null,
              llmModelId: null,
            },
          };
        },
      };
      const h = harness({
        thinkingFloorMs: 200,
        resolveSession: async () => ({ modePrompt: "p", deps }),
      });

      await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
      await h.controller.dispatch({ kind: "finish_recording", mode_id: "default" });
      const oldPending = h.controller.onCaptureAudio({
        sessionId: "sess-1",
        wavBase64: "UklGRg==",
        durationMs: 1500,
        peak: 0.5,
        voicedMs: 1000,
      });
      for (let i = 0; i < 10 && !oldModelStarted; i++) await flushAsyncWork();
      expect(oldModelStarted).toBe(true);

      await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
      await h.controller.dispatch({ kind: "finish_recording", mode_id: "default" });
      const newPending = h.controller.onCaptureAudio({
        sessionId: "sess-2",
        wavBase64: "UklGRg==",
        durationMs: 1500,
        peak: 0.5,
        voicedMs: 1000,
      });
      for (let i = 0; i < 10 && !newModelStarted; i++) await flushAsyncWork();
      expect(newModelStarted).toBe(true);

      releaseOldModel();
      for (let i = 0; i < 10; i++) await flushAsyncWork();

      releaseNewModel();
      for (let i = 0; i < 10; i++) await flushAsyncWork();
      expect(kinds(h.events).filter((kind) => kind === "completed")).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(200);
      await oldPending;
      await newPending;

      expect(kinds(h.events).filter((kind) => kind === "completed")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a new session disposes a previous in-flight realtime transport", async () => {
    const deps = fakeDeps().deps;
    let rejectModel: (err: Error) => void = () => {};
    let modelStarted = false;
    deps.modelRuntime = {
      respond: async () => {
        modelStarted = true;
        return new Promise<ModelOutput>((_resolve, reject) => {
          rejectModel = reject;
        });
      },
    };
    let disposed = 0;
    const h = harness({
      resolveSession: async () => ({
        modePrompt: "p",
        deps,
        dispose: () => {
          disposed += 1;
          rejectModel(new Error("disposed"));
        },
      }),
    });

    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    await h.controller.dispatch({ kind: "finish_recording", mode_id: "default" });
    const stale = h.controller.onCaptureAudio({
      sessionId: "sess-1",
      wavBase64: "UklGRg==",
      durationMs: 1500,
      peak: 0.5,
      voicedMs: 1000,
    });
    for (let i = 0; i < 50 && !modelStarted; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(modelStarted).toBe(true);

    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    await stale;

    expect(disposed).toBe(1);
    expect(kinds(h.events).filter((kind) => kind === "error")).toHaveLength(0);
    expect(kinds(h.events).filter((kind) => kind === "started")).toHaveLength(2);
    expect(h.controller.activeModeId()).toBe("default");
  });

  it("cancel is exempt from the floor (instant retraction)", async () => {
    const h = harness({ thinkingFloorMs: 5000 });
    await h.controller.dispatch({ kind: "start_recording", mode_id: "default" });
    await h.controller.dispatch({ kind: "finish_recording", mode_id: "default" });
    await h.controller.dispatch({ kind: "cancel_recording", mode_id: "default" });
    expect(kinds(h.events)).toContain("cancelled"); // emitted synchronously
  });
});
