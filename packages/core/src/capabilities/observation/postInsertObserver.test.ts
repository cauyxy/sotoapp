import { describe, expect, it } from "vitest";
import { NoopPostInsertObserver } from "./postInsertObserver.js";

describe("NoopPostInsertObserver", () => {
  it("starts synchronously and returns a cancel handle", () => {
    const observed: unknown[] = [];
    const handle = NoopPostInsertObserver.start({
      historyId: "history.1",
      sessionId: "session.1",
      target: {
        id: "target.1",
        capturedAt: 1_700_000_000_000,
        reason: "post_insert_observation",
        platform: "macos",
        app: {
          pid: 42,
          bundleId: "com.example.App",
          localizedName: "Example",
          executableName: "Example",
        },
        window: { title: "Document" },
        ax: null,
        focusedElement: null,
        selection: { text: "", source: "none", confidence: "low" },
        ambientClipboard: null,
      },
      injectedText: "hello",
      injectionOutcome: { kind: "paste_sent" },
      startedAt: 1_700_000_000_000,
      timeoutMs: 1_500,
      onObservation: (event) => observed.push(event),
    });

    expect(() => handle.cancel()).not.toThrow();
    expect(observed).toEqual([
      {
        edited_text: null,
        edited_text_status: "not_observed",
        edited_text_status_reason: "observer_not_attached",
        ax_context_at_end: null,
      },
    ]);
  });
});
