import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listenWithCleanup } from "./listenWithCleanup";

const listenMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, handler: unknown) => listenMock(event, handler)
}));

describe("listenWithCleanup", () => {
  beforeEach(() => {
    listenMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls unlisten when cleanup runs after listen resolves", async () => {
    const unlisten = vi.fn();
    listenMock.mockResolvedValue(unlisten);

    const cleanup = listenWithCleanup("soto://voice-runtime", vi.fn());
    expect(listenMock).toHaveBeenCalledWith("soto://voice-runtime", expect.any(Function));

    await Promise.resolve();
    cleanup();

    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("calls unlisten immediately when cleanup runs before listen resolves", async () => {
    const unlisten = vi.fn();
    let resolveListen: ((next: () => void) => void) | undefined;
    const listenDeferred = new Promise<() => void>((resolve) => {
      resolveListen = resolve;
    });
    listenMock.mockReturnValue(listenDeferred);

    const cleanup = listenWithCleanup("soto://voice-runtime", vi.fn());
    cleanup();

    expect(listenMock).toHaveBeenCalledWith("soto://voice-runtime", expect.any(Function));
    expect(unlisten).not.toHaveBeenCalled();

    resolveListen?.(unlisten);
    await Promise.resolve();

    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("invokes onError when listen promise rejects", async () => {
    const onError = vi.fn();
    const error = new Error("failed to subscribe");
    listenMock.mockRejectedValue(error);

    listenWithCleanup("soto://voice-runtime", vi.fn(), { onError });
    await Promise.resolve();
    await Promise.resolve();

    expect(onError).toHaveBeenCalledWith(error);
  });
});
