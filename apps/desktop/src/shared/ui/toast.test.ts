import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TOAST_DURATION_MS, peekToasts, subscribeToasts, toast } from "./toast";

describe("toast store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it("pushes a toast item and notifies subscribers", () => {
    const seen: number[] = [];
    const unsubscribe = subscribeToasts(() => {
      seen.push(peekToasts().length);
    });

    toast("Saved");
    expect(peekToasts()).toHaveLength(1);
    expect(peekToasts()[0]?.text).toBe("Saved");
    expect(seen).toEqual([1]);

    unsubscribe();
  });

  it("removes the toast after TOAST_DURATION_MS", () => {
    toast("Saved");
    expect(peekToasts()).toHaveLength(1);

    vi.advanceTimersByTime(TOAST_DURATION_MS - 1);
    expect(peekToasts()).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(peekToasts()).toHaveLength(0);
  });

  it("stacks multiple toasts with independent ids and lifecycles", () => {
    toast("First");
    vi.advanceTimersByTime(500);
    toast("Second");

    const items = peekToasts();
    expect(items).toHaveLength(2);
    expect(items[0]?.text).toBe("First");
    expect(items[1]?.text).toBe("Second");
    expect(items[0]?.id).not.toBe(items[1]?.id);

    vi.advanceTimersByTime(TOAST_DURATION_MS - 500);
    expect(peekToasts().map((item) => item.text)).toEqual(["Second"]);

    vi.advanceTimersByTime(500);
    expect(peekToasts()).toHaveLength(0);
  });
});
