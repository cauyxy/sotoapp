import { describe, expect, it, vi } from "vitest";

import type { AppModel } from "../ipc";
import { createAppResources, type AppResourcesDeps } from "./resources.js";

// The controller treats AppModel opaquely (it loads/refreshes/passes it through
// but never reads its fields), so a tagged stand-in is enough to track identity.
function fakeModel(tag: string): AppModel {
  return { activeModeId: tag } as unknown as AppModel;
}

function harness(over: Partial<AppResourcesDeps> = {}) {
  let voiceCb: ((payload: unknown) => void) | null = null;
  let unsubscribed = false;
  const getAppModel = vi.fn(async () => fakeModel("m1"));
  const deps: AppResourcesDeps = {
    getAppModel,
    onVoiceRuntime: (cb) => {
      voiceCb = cb;
      return () => {
        voiceCb = null;
        unsubscribed = true;
      };
    },
    hasBridge: () => true,
    ...over,
  };
  const resources = createAppResources(deps);
  return {
    resources,
    getAppModel,
    emitVoice: (payload: unknown) => voiceCb?.(payload),
    wasUnsubscribed: () => unsubscribed,
  };
}

describe("createAppResources", () => {
  it("starts in the loading state", () => {
    const { resources } = harness();
    expect(resources.getSnapshot()).toEqual({ status: "loading" });
  });

  it("loadInitial resolves to ready and notifies subscribers", async () => {
    const { resources } = harness();
    const listener = vi.fn();
    resources.subscribe(listener);

    await resources.loadInitial();

    expect(resources.getSnapshot()).toEqual({ status: "ready", model: fakeModel("m1") });
    expect(listener).toHaveBeenCalled();
  });

  it("loadInitial reports unavailable when the bridge is missing (no fetch)", async () => {
    const { resources, getAppModel } = harness({ hasBridge: () => false });
    await resources.loadInitial();
    expect(resources.getSnapshot()).toEqual({ status: "unavailable" });
    expect(getAppModel).not.toHaveBeenCalled();
  });

  it("loadInitial reports an error when the fetch rejects", async () => {
    const { resources } = harness({ getAppModel: vi.fn(() => Promise.reject(new Error("boom"))) });
    await resources.loadInitial();
    const snapshot = resources.getSnapshot();
    expect(snapshot.status).toBe("error");
    if (snapshot.status !== "error") throw new Error("unreachable");
    expect(snapshot.message).toContain("boom");
  });

  it("refresh replaces the model with the freshly fetched one", async () => {
    const getAppModel = vi.fn();
    getAppModel.mockResolvedValueOnce(fakeModel("m1")).mockResolvedValueOnce(fakeModel("m2"));
    const { resources } = harness({ getAppModel });

    await resources.loadInitial();
    await resources.refresh("history");

    expect(resources.getSnapshot()).toEqual({ status: "ready", model: fakeModel("m2") });
  });

  it("keeps the last good model when a refresh fails (transient)", async () => {
    const getAppModel = vi.fn();
    getAppModel.mockResolvedValueOnce(fakeModel("m1")).mockRejectedValueOnce(new Error("net"));
    const { resources } = harness({ getAppModel });

    await resources.loadInitial();
    await resources.refresh("history");

    expect(resources.getSnapshot()).toEqual({ status: "ready", model: fakeModel("m1") });
  });

  it("refreshes after a terminal voice-runtime event", async () => {
    const { resources, getAppModel, emitVoice } = harness();
    await resources.loadInitial();
    expect(getAppModel).toHaveBeenCalledTimes(1);

    emitVoice({ kind: "completed", history_id: "h1" });
    await Promise.resolve();
    await Promise.resolve();

    expect(getAppModel).toHaveBeenCalledTimes(2);
  });

  it("ignores non-terminal voice-runtime events", async () => {
    const { resources, getAppModel, emitVoice } = harness();
    await resources.loadInitial();

    emitVoice({ kind: "level", rms: 1, peak: 2 });
    emitVoice({ kind: "started", handle_id: "h", mode_id: "default", status: "listening" });
    await Promise.resolve();

    expect(getAppModel).toHaveBeenCalledTimes(1);
  });

  it("does not refresh on a terminal event before the model is loaded", async () => {
    const { getAppModel, emitVoice } = harness();
    emitVoice({ kind: "failed", history_id: "h1" });
    await Promise.resolve();
    expect(getAppModel).not.toHaveBeenCalled();
  });

  it("mutate runs the action then refreshes, returning the action result", async () => {
    const order: string[] = [];
    const getAppModel = vi.fn(async () => {
      order.push("refresh");
      return fakeModel("m1");
    });
    const { resources } = harness({ getAppModel });
    await resources.loadInitial();
    order.length = 0;

    const result = await resources.mutate(async () => {
      order.push("action");
      return "deleted";
    }, "history");

    expect(result).toBe("deleted");
    expect(order).toEqual(["action", "refresh"]);
  });

  it("mutate propagates an action failure and does not refresh", async () => {
    const { resources, getAppModel } = harness();
    await resources.loadInitial();
    getAppModel.mockClear();

    await expect(
      resources.mutate(() => Promise.reject(new Error("save failed")), "history"),
    ).rejects.toThrow("save failed");
    expect(getAppModel).not.toHaveBeenCalled();
  });

  it("stops notifying after unsubscribe", async () => {
    const { resources } = harness();
    const listener = vi.fn();
    const unsubscribe = resources.subscribe(listener);
    unsubscribe();
    await resources.loadInitial();
    expect(listener).not.toHaveBeenCalled();
  });

  it("dispose unsubscribes the voice-runtime listener", async () => {
    const { resources, getAppModel, emitVoice, wasUnsubscribed } = harness();
    await resources.loadInitial();
    resources.dispose();
    expect(wasUnsubscribed()).toBe(true);

    getAppModel.mockClear();
    emitVoice({ kind: "completed", history_id: "h1" });
    await Promise.resolve();
    expect(getAppModel).not.toHaveBeenCalled();
  });
});
