import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AppInfo,
  AxContext,
  PostInsertObservation,
  PostInsertObserverRequest,
} from "@soto/core";
import {
  NativePostInsertObserver,
  type NativePostInsertObserverOptions,
} from "./nativePostInsertObserver.js";

const app: AppInfo = {
  pid: 42,
  bundleId: "com.example.App",
  localizedName: "Example",
};

const ax: AxContext = {
  full_text: "hello",
  selection_start: 5,
  selection_end: 5,
  before: "hello",
  after: "",
  ax_role: "AXTextArea",
  focused_element_id: "ax.1",
  app_bundle_id: "com.example.App",
  app_name: "Example",
  window_title: "Doc",
  web_url: null,
  web_domain: null,
};

function request(
  over: Partial<PostInsertObserverRequest> = {},
): PostInsertObserverRequest {
  return {
    historyId: "history.1",
    sessionId: "session.1",
    target: {
      id: "target.1",
      capturedAt: 1,
      reason: "post_insert_observation",
      platform: "macos",
      app: {
        pid: app.pid,
        bundleId: app.bundleId ?? null,
        localizedName: app.localizedName,
        executableName: "Example",
      },
      window: { title: "Doc" },
      ax,
      focusedElement: null,
      selection: { text: "", source: "none", confidence: "low" },
      ambientClipboard: null,
    },
    injectedText: "hello",
    injectionOutcome: { kind: "paste_sent" },
    startedAt: 1,
    timeoutMs: 1_000,
    onObservation: vi.fn(),
    ...over,
  };
}

describe("NativePostInsertObserver", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns before running native capture callbacks", async () => {
    const frontmostApp = vi.fn(() => app);
    const captureAxContext = vi.fn(() => ({ ...ax, window_title: null }));
    const captureWindowTitle = vi.fn(() => "Doc");
    const observer = observerWith({
      frontmostApp,
      captureAxContext,
      captureWindowTitle,
    });

    observer.start(request());

    expect(frontmostApp).not.toHaveBeenCalled();
    expect(captureAxContext).not.toHaveBeenCalled();
    expect(captureWindowTitle).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(0);

    expect(frontmostApp).toHaveBeenCalledOnce();
    expect(captureAxContext).toHaveBeenCalledOnce();
    expect(captureWindowTitle).toHaveBeenCalledOnce();
  });

  it("does not start later native reads after one poll spends its capture deadline", async () => {
    const frontmostApp = vi.fn(() => new Promise<AppInfo | null>(() => {}));
    const captureAxContext = vi.fn(() => ax);
    const captureWindowTitle = vi.fn(() => "Doc");
    const observer = observerWith({
      frontmostApp,
      captureAxContext,
      captureWindowTitle,
      captureDeadlineMs: 25,
      pollMs: 100,
    });

    observer.start(request());

    await vi.advanceTimersByTimeAsync(0);
    expect(frontmostApp).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(25);

    expect(captureAxContext).not.toHaveBeenCalled();
    expect(captureWindowTitle).not.toHaveBeenCalled();
  });

  it("captures the last related readable AX value at timeout", async () => {
    const observed: PostInsertObservation[] = [];
    const observedAx = { ...ax, full_text: "hello!", before: "hello!" };
    const observer = new NativePostInsertObserver({
      frontmostApp: () => app,
      captureAxContext: () => observedAx,
      captureWindowTitle: () => "Doc",
      pollMs: 100,
    });

    observer.start(request({ onObservation: (event) => observed.push(event) }));
    await vi.advanceTimersByTimeAsync(1_000);

    expect(observed).toEqual([
      {
        edited_text: "hello!",
        edited_text_status: "captured",
        edited_text_status_reason: null,
        ax_context_at_end: observedAx,
      },
    ]);
  });

  it("awaits async native reads before recording a stable value", async () => {
    const observed: PostInsertObservation[] = [];
    const observedAx = { ...ax, full_text: "hello async", before: "hello async" };
    const observer = new NativePostInsertObserver({
      frontmostApp: () => Promise.resolve(app),
      captureAxContext: () => Promise.resolve(observedAx),
      captureWindowTitle: () => Promise.resolve("Doc"),
      pollMs: 100,
    });

    observer.start(request({ onObservation: (event) => observed.push(event) }));
    await vi.advanceTimersByTimeAsync(1_000);

    expect(observed).toEqual([
      {
        edited_text: "hello async",
        edited_text_status: "captured",
        edited_text_status_reason: null,
        ax_context_at_end: observedAx,
      },
    ]);
  });

  it("keeps the last stable non-empty related text when the field is cleared", async () => {
    const axValues = [
      { ...ax, full_text: "hello again", before: "hello again" },
      { ...ax, full_text: "", before: "" },
    ];
    const observed: PostInsertObservation[] = [];
    const observer = new NativePostInsertObserver({
      frontmostApp: () => app,
      captureAxContext: () => axValues.shift() ?? axValues[0]!,
      captureWindowTitle: () => "Doc",
      pollMs: 100,
    });

    observer.start(request({ onObservation: (event) => observed.push(event) }));
    await vi.advanceTimersByTimeAsync(1_000);

    expect(observed[0]?.edited_text).toBe("hello again");
    expect(observed[0]?.edited_text_status).toBe("captured");
  });

  it("marks target_changed when the focused app no longer matches", async () => {
    const observed: PostInsertObservation[] = [];
    const observer = new NativePostInsertObserver({
      frontmostApp: () => ({
        pid: 7,
        bundleId: "com.other.App",
        localizedName: "Other",
      }),
      captureAxContext: () => ({ ...ax, app_bundle_id: "com.other.App" }),
      captureWindowTitle: () => "Doc",
      pollMs: 100,
    });

    observer.start(request({ onObservation: (event) => observed.push(event) }));
    await vi.advanceTimersByTimeAsync(0);

    expect(observed).toEqual([
      {
        edited_text: null,
        edited_text_status: "unavailable",
        edited_text_status_reason: "target_changed",
        ax_context_at_end: null,
      },
    ]);
  });

  it("keeps a captured stable value when focus changes before timeout", async () => {
    const observed: PostInsertObservation[] = [];
    const stableAx = { ...ax, full_text: "hello!", before: "hello!" };
    const apps = [
      app,
      { pid: 7, bundleId: "com.other.App", localizedName: "Other" },
    ];
    const contexts = [stableAx, { ...ax, app_bundle_id: "com.other.App" }];
    const observer = new NativePostInsertObserver({
      frontmostApp: () => apps.shift() ?? apps[0]!,
      captureAxContext: () => contexts.shift() ?? contexts[0]!,
      captureWindowTitle: () => "Doc",
      pollMs: 100,
    });

    observer.start(request({ onObservation: (event) => observed.push(event) }));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);

    expect(observed).toEqual([
      {
        edited_text: "hello!",
        edited_text_status: "captured",
        edited_text_status_reason: null,
        ax_context_at_end: stableAx,
      },
    ]);
  });

  it("fails closed when current identity is unavailable for an identified target", async () => {
    const observed: PostInsertObservation[] = [];
    const observer = new NativePostInsertObserver({
      frontmostApp: () => null,
      captureAxContext: () => null,
      captureWindowTitle: () => null,
      pollMs: 100,
    });

    observer.start(request({ onObservation: (event) => observed.push(event) }));
    await vi.advanceTimersByTimeAsync(0);

    expect(observed[0]?.edited_text_status).toBe("unavailable");
    expect(observed[0]?.edited_text_status_reason).toBe("target_changed");
  });

  it("marks same-app different-window or control reads as target_changed", async () => {
    const observed: PostInsertObservation[] = [];
    const observer = new NativePostInsertObserver({
      frontmostApp: () => app,
      captureAxContext: () => ({
        ...ax,
        window_title: "Other Doc",
        ax_role: "AXSearchField",
      }),
      captureWindowTitle: () => "Other Doc",
      pollMs: 100,
    });

    observer.start(request({ onObservation: (event) => observed.push(event) }));
    await vi.advanceTimersByTimeAsync(0);

    expect(observed[0]?.edited_text_status).toBe("unavailable");
    expect(observed[0]?.edited_text_status_reason).toBe("target_changed");
  });

  it("uses the window-title fallback when AX capture omits the title", async () => {
    const observed: PostInsertObservation[] = [];
    const observer = new NativePostInsertObserver({
      frontmostApp: () => app,
      captureAxContext: () => ({ ...ax, full_text: "hello!", window_title: null }),
      captureWindowTitle: () => "Doc",
      pollMs: 100,
    });

    observer.start(request({ onObservation: (event) => observed.push(event) }));
    await vi.advanceTimersByTimeAsync(1_000);

    expect(observed[0]?.edited_text_status).toBe("captured");
    expect(observed[0]?.edited_text).toBe("hello!");
  });

  it("prefers the active-window title fallback when AX title diverges", async () => {
    const observed: PostInsertObservation[] = [];
    const observer = new NativePostInsertObserver({
      frontmostApp: () => app,
      captureAxContext: () => ({
        ...ax,
        full_text: "hello!",
        window_title: "AX stale title",
      }),
      captureWindowTitle: () => "Doc",
      pollMs: 100,
    });

    observer.start(request({ onObservation: (event) => observed.push(event) }));
    await vi.advanceTimersByTimeAsync(1_000);

    expect(observed[0]?.edited_text_status).toBe("captured");
    expect(observed[0]?.edited_text).toBe("hello!");
  });

  it("does not capture text that only repeats the starting baseline", async () => {
    const observed: PostInsertObservation[] = [];
    const observer = new NativePostInsertObserver({
      frontmostApp: () => app,
      captureAxContext: () => ax,
      captureWindowTitle: () => "Doc",
      pollMs: 100,
    });

    observer.start(request({ onObservation: (event) => observed.push(event) }));
    await vi.advanceTimersByTimeAsync(1_000);

    expect(observed).toEqual([
      {
        edited_text: null,
        edited_text_status: "unavailable",
        edited_text_status_reason: "observer_timeout",
        ax_context_at_end: null,
      },
    ]);
  });

  it("does not capture partial prefixes of the injected text", async () => {
    const observed: PostInsertObservation[] = [];
    const observer = new NativePostInsertObserver({
      frontmostApp: () => app,
      captureAxContext: () => ({ ...ax, full_text: "", before: "", selection_start: 0, selection_end: 0 }),
      captureWindowTitle: () => "Doc",
      pollMs: 100,
    });

    observer.start(
      request({
        injectedText: "hello world",
        target: {
          ...request().target,
          ax: { ...ax, full_text: "", before: "", selection_start: 0, selection_end: 0 },
        },
        onObservation: (event) => observed.push(event),
      }),
    );
    await vi.advanceTimersByTimeAsync(1_000);

    expect(observed[0]?.edited_text_status).toBe("unavailable");
    expect(observed[0]?.edited_text_status_reason).toBe("observer_timeout");
  });

  it("does not capture injected-looking text without a start AX baseline", async () => {
    const observed: PostInsertObservation[] = [];
    const observer = new NativePostInsertObserver({
      frontmostApp: () => app,
      captureAxContext: () => null,
      captureWindowTitle: () => "Doc",
      pollMs: 100,
    });

    observer.start(
      request({
        target: { ...request().target, ax: null },
        onObservation: (event) => observed.push(event),
      }),
    );
    await vi.advanceTimersByTimeAsync(1_000);

    expect(observed[0]?.edited_text_status).toBe("unavailable");
    expect(observed[0]?.edited_text_status_reason).toBe("observer_timeout");
  });

  it("does not treat synthesized identity-only AX context as a text baseline", async () => {
    const observed: PostInsertObservation[] = [];
    const synthesizedAx = {
      ...ax,
      full_text: "",
      selection_start: 0,
      selection_end: 0,
      before: "",
      after: "",
      ax_role: null,
    };
    const observer = new NativePostInsertObserver({
      frontmostApp: () => app,
      captureAxContext: () => null,
      captureWindowTitle: () => "Doc",
      pollMs: 100,
    });

    observer.start(
      request({
        target: { ...request().target, ax: synthesizedAx },
        onObservation: (event) => observed.push(event),
      }),
    );
    await vi.advanceTimersByTimeAsync(1_000);

    expect(observed[0]?.edited_text_status).toBe("unavailable");
    expect(observed[0]?.edited_text_status_reason).toBe("target_changed");
  });

  it("marks AX-backed targets without focused element identity unsupported before native reads", async () => {
    const observed: PostInsertObservation[] = [];
    const unidentifiedAx = { ...ax, focused_element_id: null };
    const frontmostApp = vi.fn(() => app);
    const captureAxContext = vi.fn(() => ({ ...unidentifiedAx, full_text: "hello!" }));
    const captureWindowTitle = vi.fn(() => "Doc");
    const observer = new NativePostInsertObserver({
      frontmostApp,
      captureAxContext,
      captureWindowTitle,
      pollMs: 100,
    });

    observer.start(
      request({
        target: { ...request().target, ax: unidentifiedAx },
        onObservation: (event) => observed.push(event),
      }),
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(observed[0]?.edited_text_status).toBe("unavailable");
    expect(observed[0]?.edited_text_status_reason).toBe("observer_unsupported");
    expect(frontmostApp).not.toHaveBeenCalled();
    expect(captureAxContext).not.toHaveBeenCalled();
    expect(captureWindowTitle).not.toHaveBeenCalled();
  });

  it("rejects AX-backed targets that only have focusedElement value signatures", async () => {
    const observed: PostInsertObservation[] = [];
    const unidentifiedAx = { ...ax, focused_element_id: null };
    const observer = new NativePostInsertObserver({
      frontmostApp: () => app,
      captureAxContext: () => ({ ...ax, full_text: "hello!" }),
      captureWindowTitle: () => "Doc",
      pollMs: 100,
    });

    observer.start(
      request({
        target: {
          ...request().target,
          ax: unidentifiedAx,
          focusedElement: {
            axRole: "AXTextArea",
            isSecureTextEntry: false,
            bounds: null,
            valueSignature: "ax.1",
          },
        },
        onObservation: (event) => observed.push(event),
      }),
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(observed[0]?.edited_text_status).toBe("unavailable");
    expect(observed[0]?.edited_text_status_reason).toBe("observer_unsupported");
  });

  it("captures a real empty AX text baseline when injected text appears", async () => {
    const observed: PostInsertObservation[] = [];
    const emptyTextAx = {
      ...ax,
      full_text: "",
      selection_start: 0,
      selection_end: 0,
      before: "",
      after: "",
      ax_role: "ValuePattern",
      focused_element_id: "uia.1",
    };
    const observer = new NativePostInsertObserver({
      frontmostApp: () => app,
      captureAxContext: () => ({ ...emptyTextAx, full_text: "hello" }),
      captureWindowTitle: () => "Doc",
      pollMs: 100,
    });

    observer.start(
      request({
        target: { ...request().target, ax: emptyTextAx },
        onObservation: (event) => observed.push(event),
      }),
    );
    await vi.advanceTimersByTimeAsync(1_000);

    expect(observed[0]?.edited_text_status).toBe("captured");
    expect(observed[0]?.edited_text).toBe("hello");
  });

  it("treats Windows TextPattern and ValuePattern markers as same-control provenance", async () => {
    const observed: PostInsertObservation[] = [];
    const observer = new NativePostInsertObserver({
      frontmostApp: () => app,
      captureAxContext: () => ({
        ...ax,
        full_text: "replacement",
        ax_role: "ValuePattern",
        focused_element_id: "uia.1",
      }),
      captureWindowTitle: () => "Doc",
      pollMs: 100,
    });

    observer.start(
      request({
        injectedText: "replacement",
        target: {
          ...request().target,
          ax: {
            ...ax,
            full_text: "selected",
            ax_role: "TextPattern",
            focused_element_id: "uia.1",
          },
        },
        onObservation: (event) => observed.push(event),
      }),
    );
    await vi.advanceTimersByTimeAsync(1_000);

    expect(observed[0]?.edited_text_status).toBe("captured");
    expect(observed[0]?.edited_text).toBe("replacement");
  });

  it("rejects same-window Windows reads from a different focused element", async () => {
    const observed: PostInsertObservation[] = [];
    const observer = new NativePostInsertObserver({
      frontmostApp: () => app,
      captureAxContext: () => ({
        ...ax,
        full_text: "replacement in another field",
        ax_role: "ValuePattern",
        focused_element_id: "uia.2",
      }),
      captureWindowTitle: () => "Doc",
      pollMs: 100,
    });

    observer.start(
      request({
        injectedText: "replacement",
        target: {
          ...request().target,
          ax: {
            ...ax,
            full_text: "selected",
            ax_role: "TextPattern",
            focused_element_id: "uia.1",
          },
        },
        onObservation: (event) => observed.push(event),
      }),
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(observed[0]?.edited_text_status).toBe("unavailable");
    expect(observed[0]?.edited_text_status_reason).toBe("target_changed");
  });

  it("captures a real TextPattern-only empty AX baseline when injected text appears", async () => {
    const observed: PostInsertObservation[] = [];
    const emptyTextAx = {
      ...ax,
      full_text: "",
      selection_start: 0,
      selection_end: 0,
      before: "",
      after: "",
      ax_role: "TextPattern",
      focused_element_id: "uia.1",
    };
    const observer = new NativePostInsertObserver({
      frontmostApp: () => app,
      captureAxContext: () => ({ ...emptyTextAx, full_text: "hello" }),
      captureWindowTitle: () => "Doc",
      pollMs: 100,
    });

    observer.start(
      request({
        target: { ...request().target, ax: emptyTextAx },
        onObservation: (event) => observed.push(event),
      }),
    );
    await vi.advanceTimersByTimeAsync(1_000);

    expect(observed[0]?.edited_text_status).toBe("captured");
    expect(observed[0]?.edited_text).toBe("hello");
  });

  it("marks unsupported injection outcomes unavailable immediately", async () => {
    const observed: PostInsertObservation[] = [];
    const frontmostApp = vi.fn(() => app);
    const captureAxContext = vi.fn(() => ax);
    const captureWindowTitle = vi.fn(() => "Doc");
    const observer = new NativePostInsertObserver({
      frontmostApp,
      captureAxContext,
      captureWindowTitle,
      pollMs: 100,
    });

    observer.start(
      request({
        injectionOutcome: { kind: "manual_copy_required", reason: "clipboard_unrestorable" },
        onObservation: (event) => observed.push(event),
      }),
    );

    expect(observed).toEqual([
      {
        edited_text: null,
        edited_text_status: "unavailable",
        edited_text_status_reason: "unsupported_injection_outcome",
        ax_context_at_end: null,
      },
    ]);
    expect(frontmostApp).not.toHaveBeenCalled();
    expect(captureAxContext).not.toHaveBeenCalled();
    expect(captureWindowTitle).not.toHaveBeenCalled();
  });

  it("does not emit after cancel", async () => {
    const observed: PostInsertObservation[] = [];
    const observer = new NativePostInsertObserver({
      frontmostApp: () => app,
      captureAxContext: () => ax,
      captureWindowTitle: () => "Doc",
      pollMs: 100,
    });

    const handle = observer.start(
      request({ onObservation: (event) => observed.push(event) }),
    );
    handle.cancel();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(observed).toEqual([]);
  });
});

function observerWith(
  options: Partial<NativePostInsertObserverOptions> = {},
): NativePostInsertObserver {
  return new NativePostInsertObserver({
    frontmostApp: () => app,
    captureAxContext: () => ax,
    captureWindowTitle: () => "Doc",
    pollMs: 100,
    ...options,
  });
}
