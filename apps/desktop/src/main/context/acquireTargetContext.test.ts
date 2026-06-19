import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TARGET_CONTEXT_CAPTURE_DEADLINE_MS,
  acquireTargetContext,
  type TargetContextPorts,
} from "./acquireTargetContext.js";

function fakePorts(overrides: Partial<TargetContextPorts> = {}): TargetContextPorts {
  return {
    frontmostApp: () => ({
      pid: 1,
      bundleId: "com.test.app",
      localizedName: "Test",
    }),
    captureAxContext: () => ({
      full_text: "hello world",
      selection_start: 0,
      selection_end: 5,
      before: "",
      after: "",
      ax_role: null,
      app_bundle_id: "com.test.app",
      app_name: "Test",
      window_title: "Doc",
      web_url: null,
      web_domain: null,
    }),
    captureWindowTitle: () => "Doc - Test",
    probeFocus: () => "editable",
    now: () => 1000,
    uuid: () => "snap-1",
    ...overrides,
  };
}

describe("acquireTargetContext", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("voice reason captures target identity and selected text from AX only", async () => {
    const ports = fakePorts();

    const result = await acquireTargetContext(
      ports,
      "voice_session_start",
      { clipboardContextMode: "off" },
      true,
    );

    expect(result.snapshot.app.bundleId).toBe("com.test.app");
    expect(result.appContext.identity.bundleId).toBe("com.test.app");
    expect(result.selectedText).toBe("hello");
    expect(result.selectionSource).toBe("ax_selection");
  });

  it("voice reason returns a promise and backfills AX identity", async () => {
    const ports = fakePorts({
      captureAxContext: () => ({
        full_text: "",
        selection_start: 0,
        selection_end: 0,
        before: "",
        after: "",
        ax_role: null,
        app_bundle_id: null,
        app_name: null,
        window_title: null,
        web_url: null,
        web_domain: null,
      }),
      captureWindowTitle: () => "Doc - Test",
    });

    const result = acquireTargetContext(
      ports,
      "voice_session_start",
      { clipboardContextMode: "off" },
      true,
    );

    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toMatchObject({
      snapshot: {
        ax: {
          app_bundle_id: "com.test.app",
          app_name: "Test",
          window_title: "Doc - Test",
        },
      },
    });
  });

  it("captures frontmost app before awaiting focus probe", async () => {
    const order: string[] = [];
    let resolveFocus!: (value: "editable") => void;
    const focusPromise = new Promise<"editable">((resolve) => {
      resolveFocus = resolve;
    });
    const ports = fakePorts({
      frontmostApp: () => {
        order.push("frontmostApp");
        return {
          pid: 9,
          bundleId: "com.target.before-await",
          localizedName: "BeforeAwait",
        };
      },
      probeFocus: () => {
        order.push("probeFocus");
        return focusPromise;
      },
      captureAxContext: () => {
        order.push("captureAxContext");
        return null;
      },
      captureWindowTitle: () => {
        order.push("captureWindowTitle");
        return null;
      },
    });

    const pending = acquireTargetContext(
      ports,
      "voice_session_start",
      { clipboardContextMode: "off" },
      true,
    );

    // frontmostApp is captured synchronously; the focus probe is deferred to a
    // microtask by safeAsync (Promise.resolve().then(fn)), so flush one tick
    // before asserting the call order.
    await Promise.resolve();
    expect(order).toEqual(["frontmostApp", "probeFocus"]);

    resolveFocus("editable");
    const result = await pending;

    expect(order).toEqual([
      "frontmostApp",
      "probeFocus",
      "captureAxContext",
      "captureWindowTitle",
    ]);
    expect(result.savedApp?.bundleId).toBe("com.target.before-await");
    expect(result.snapshot.app.bundleId).toBe("com.target.before-await");
  });

  it("times out a slow AX capture, degrades to app identity, and logs no text content", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const logs: string[] = [];
    const ports = fakePorts({
      captureAxContext: () => new Promise<null>(() => {}),
      captureWindowTitle: () => "Private Roadmap",
      log: (message) => logs.push(message),
      now: () => Date.now(),
    });

    const resultPromise = acquireTargetContext(
      ports,
      "voice_session_start",
      { clipboardContextMode: "off" },
      true,
    );
    await vi.advanceTimersByTimeAsync(DEFAULT_TARGET_CONTEXT_CAPTURE_DEADLINE_MS);

    const result = await resultPromise;

    expect(result.selectedText).toBe("");
    expect(result.selectionSource).toBe("none");
    expect(result.snapshot.app.bundleId).toBe("com.test.app");
    expect(result.snapshot.ax).toMatchObject({
      app_bundle_id: "com.test.app",
      app_name: "Test",
      window_title: null,
    });
    expect(logs).toContain(
      `[focus-diag] capture stage=captureAxContext elapsed_ms=${DEFAULT_TARGET_CONTEXT_CAPTURE_DEADLINE_MS} timed_out=true`,
    );
    expect(logs).toContain(
      "[focus-diag] capture stage=captureWindowTitle elapsed_ms=0 timed_out=true",
    );
    expect(logs.join("\n")).not.toContain("hello world");
    expect(logs.join("\n")).not.toContain("Private Roadmap");
  });

  it("does not start later capture stages after the shared deadline is exhausted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const logs: string[] = [];
    const captureAxContext = vi.fn(() => null);
    const captureWindowTitle = vi.fn(() => "Late Window");
    const ports = fakePorts({
      captureAxContext,
      captureWindowTitle,
      probeFocus: () => new Promise<"editable">(() => {}),
      log: (message) => logs.push(message),
      now: () => Date.now(),
    });

    const resultPromise = acquireTargetContext(
      ports,
      "voice_session_start",
      { clipboardContextMode: "off" },
      true,
    );
    await vi.advanceTimersByTimeAsync(DEFAULT_TARGET_CONTEXT_CAPTURE_DEADLINE_MS);

    const result = await resultPromise;

    expect(result.focusStatus).toBe("timeout");
    expect(result.snapshot.app.bundleId).toBe("com.test.app");
    expect(result.snapshot.ax).toMatchObject({
      app_bundle_id: "com.test.app",
      app_name: "Test",
      window_title: null,
    });
    expect(captureAxContext).not.toHaveBeenCalled();
    expect(captureWindowTitle).not.toHaveBeenCalled();
    expect(logs).toContain(
      `[focus-diag] capture stage=probeFocus elapsed_ms=${DEFAULT_TARGET_CONTEXT_CAPTURE_DEADLINE_MS} timed_out=true`,
    );
    expect(logs).toContain(
      "[focus-diag] capture stage=captureAxContext elapsed_ms=0 timed_out=true",
    );
    expect(logs).toContain(
      "[focus-diag] capture stage=captureWindowTitle elapsed_ms=0 timed_out=true",
    );
  });
});
