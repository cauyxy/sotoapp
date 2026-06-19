import { describe, expect, it, vi } from "vitest";
import type {
  HistoryObservationWriter,
  PostInsertObservation,
  PostInsertObservationHandle,
  PostInsertObserver,
  PostInsertObserverRequest,
} from "@soto/core";
import { PostInsertObservationCoordinator } from "./postInsertObservationCoordinator.js";

const observation: PostInsertObservation = {
  edited_text: "hello!",
  edited_text_status: "captured",
  edited_text_status_reason: null,
  ax_context_at_end: null,
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
        pid: 1,
        bundleId: "com.example.App",
        localizedName: "Example",
        executableName: "Example",
      },
      window: { title: "Doc" },
      ax: null,
      focusedElement: null,
      selection: { text: "", source: "none", confidence: "low" },
      ambientClipboard: null,
    },
    injectedText: "hello",
    injectionOutcome: { kind: "paste_sent" },
    startedAt: 1,
    timeoutMs: 45_000,
    onObservation: vi.fn(),
    ...over,
  };
}

describe("PostInsertObservationCoordinator", () => {
  it("cancels the previous observer before starting a new one", () => {
    const handles: PostInsertObservationHandle[] = [];
    const observer: PostInsertObserver = {
      start: vi.fn(() => {
        const handle = { cancel: vi.fn() };
        handles.push(handle);
        return handle;
      }),
    };
    const writer: HistoryObservationWriter = {
      recordPostInsertObservation: vi.fn(async () => true),
    };
    const coordinator = new PostInsertObservationCoordinator({ observer, writer });

    const first = coordinator.start(request({ sessionId: "session.1" }));
    const second = coordinator.start(request({ sessionId: "session.2" }));

    expect(observer.start).toHaveBeenCalledTimes(2);
    expect(handles[0]!.cancel).toHaveBeenCalledOnce();
    expect(handles[1]!.cancel).not.toHaveBeenCalled();

    first.cancel();
    expect(handles[0]!.cancel).toHaveBeenCalledOnce();

    second.cancel();
    expect(handles[1]!.cancel).toHaveBeenCalledOnce();
  });

  it("writes observations asynchronously without awaiting the writer", () => {
    const observed: PostInsertObservation[] = [];
    const observer: PostInsertObserver = {
      start: vi.fn((req) => {
        req.onObservation(observation);
        return { cancel: vi.fn() };
      }),
    };
    const writer: HistoryObservationWriter = {
      recordPostInsertObservation: vi.fn(() => new Promise<boolean>(() => {})),
    };
    const coordinator = new PostInsertObservationCoordinator({ observer, writer });

    coordinator.start(
      request({
        historyId: "history.async",
        onObservation: (event) => observed.push(event),
      }),
    );

    expect(observed).toEqual([observation]);
    expect(writer.recordPostInsertObservation).toHaveBeenCalledWith(
      "history.async",
      observation,
    );
  });

  it("logs and returns a no-op handle when the observer cannot start", () => {
    const log = vi.fn();
    const observer: PostInsertObserver = {
      start: vi.fn(() => {
        throw new Error("native unavailable");
      }),
    };
    const writer: HistoryObservationWriter = {
      recordPostInsertObservation: vi.fn(async () => true),
    };
    const coordinator = new PostInsertObservationCoordinator({
      observer,
      writer,
      log,
    });

    const handle = coordinator.start(request());

    expect(() => handle.cancel()).not.toThrow();
    expect(log).toHaveBeenCalledWith(
      "post-insert observer failed to start: native unavailable",
    );
    expect(writer.recordPostInsertObservation).toHaveBeenCalledWith(
      "history.1",
      {
        edited_text: null,
        edited_text_status: "unavailable",
        edited_text_status_reason: "native_unavailable",
        ax_context_at_end: null,
      },
    );
  });

  it("logs synchronous observation writer failures", () => {
    const log = vi.fn();
    const observer: PostInsertObserver = {
      start: vi.fn((req) => {
        req.onObservation(observation);
        return { cancel: vi.fn() };
      }),
    };
    const writer: HistoryObservationWriter = {
      recordPostInsertObservation: vi.fn(() => {
        throw new Error("db locked");
      }),
    };
    const coordinator = new PostInsertObservationCoordinator({
      observer,
      writer,
      log,
    });

    coordinator.start(request());

    expect(log).toHaveBeenCalledWith(
      "post-insert observation write failed: db locked",
    );
  });

  it("records observer cancellation as a terminal observation", () => {
    const inner = { cancel: vi.fn() };
    const observer: PostInsertObserver = {
      start: vi.fn(() => inner),
    };
    const writer: HistoryObservationWriter = {
      recordPostInsertObservation: vi.fn(async () => true),
    };
    const coordinator = new PostInsertObservationCoordinator({ observer, writer });

    const handle = coordinator.start(request({ historyId: "history.cancel" }));
    handle.cancel();

    expect(inner.cancel).toHaveBeenCalledOnce();
    expect(writer.recordPostInsertObservation).toHaveBeenCalledWith(
      "history.cancel",
      {
        edited_text: null,
        edited_text_status: "unavailable",
        edited_text_status_reason: "observer_cancelled",
        ax_context_at_end: null,
      },
    );
  });

  it("clears the active observer after the first accepted terminal observation", async () => {
    let capturedRequest: PostInsertObserverRequest | null = null;
    const inner = { cancel: vi.fn() };
    const observer: PostInsertObserver = {
      start: vi.fn((req) => {
        capturedRequest = req;
        return inner;
      }),
    };
    const writer: HistoryObservationWriter = {
      recordPostInsertObservation: vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
    };
    const coordinator = new PostInsertObservationCoordinator({ observer, writer });

    coordinator.start(request({ historyId: "history.first" }));
    capturedRequest!.onObservation(observation);
    await Promise.resolve();
    capturedRequest!.onObservation({
      ...observation,
      edited_text: "late",
      edited_text_status: "unavailable",
      edited_text_status_reason: "observer_timeout",
    });

    expect(inner.cancel).toHaveBeenCalledOnce();
    expect(writer.recordPostInsertObservation).toHaveBeenCalledTimes(1);
  });

  it("does not let cancellation overwrite an in-flight terminal observation", async () => {
    let capturedRequest: PostInsertObserverRequest | null = null;
    const inner = { cancel: vi.fn() };
    const observer: PostInsertObserver = {
      start: vi.fn((req) => {
        capturedRequest = req;
        return inner;
      }),
    };
    let resolveWrite!: (accepted: boolean) => void;
    const writer: HistoryObservationWriter = {
      recordPostInsertObservation: vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            resolveWrite = resolve;
          }),
      ),
    };
    const coordinator = new PostInsertObservationCoordinator({ observer, writer });

    const handle = coordinator.start(request({ historyId: "history.race" }));
    capturedRequest!.onObservation(observation);
    handle.cancel();
    resolveWrite(true);
    await Promise.resolve();

    expect(inner.cancel).toHaveBeenCalledOnce();
    expect(writer.recordPostInsertObservation).toHaveBeenCalledTimes(1);
    expect(writer.recordPostInsertObservation).toHaveBeenCalledWith(
      "history.race",
      observation,
    );
  });
});
