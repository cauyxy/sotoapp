import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPendingDeletes } from "./pendingDeletes";

interface Rec {
  id: string;
}

function setup() {
  const committed: string[] = [];
  const restored: string[] = [];
  const helper = createPendingDeletes<Rec>({
    idOf: (r) => r.id,
    delayMs: 4000,
    commit: (r) => committed.push(r.id),
    restore: (r) => restored.push(r.id),
  });
  return { helper, committed, restored };
}

describe("createPendingDeletes", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("defers the commit until the window elapses", () => {
    const { helper, committed } = setup();
    expect(helper.schedule({ id: "a" })).toBe(true);
    expect(helper.has("a")).toBe(true);
    expect(helper.size).toBe(1);

    // Nothing committed before the window.
    vi.advanceTimersByTime(3999);
    expect(committed).toEqual([]);

    // Commits exactly at the window, and drops from pending.
    vi.advanceTimersByTime(1);
    expect(committed).toEqual(["a"]);
    expect(helper.has("a")).toBe(false);
    expect(helper.size).toBe(0);
  });

  it("undo cancels the timer and restores the record (no commit)", () => {
    const { helper, committed, restored } = setup();
    helper.schedule({ id: "a" });

    expect(helper.undo("a")).toBe(true);
    expect(restored).toEqual(["a"]);
    expect(helper.has("a")).toBe(false);

    // Timer must not fire after undo.
    vi.advanceTimersByTime(10_000);
    expect(committed).toEqual([]);
  });

  it("undo after the commit fired is a no-op (returns false, no restore)", () => {
    const { helper, committed, restored } = setup();
    helper.schedule({ id: "a" });
    vi.advanceTimersByTime(4000);
    expect(committed).toEqual(["a"]);

    expect(helper.undo("a")).toBe(false);
    expect(restored).toEqual([]);
  });

  it("ignores a repeat schedule for an already-pending id", () => {
    const { helper, committed } = setup();
    expect(helper.schedule({ id: "a" })).toBe(true);
    expect(helper.schedule({ id: "a" })).toBe(false);
    expect(helper.size).toBe(1);

    // Only ONE commit fires (no double-queued timer).
    vi.advanceTimersByTime(4000);
    expect(committed).toEqual(["a"]);
  });

  it("can re-schedule an id after it committed", () => {
    const { helper, committed } = setup();
    helper.schedule({ id: "a" });
    vi.advanceTimersByTime(4000);
    expect(committed).toEqual(["a"]);

    // No longer pending, so a fresh schedule is accepted.
    expect(helper.schedule({ id: "a" })).toBe(true);
    vi.advanceTimersByTime(4000);
    expect(committed).toEqual(["a", "a"]);
  });

  it("tracks concurrent deletes independently", () => {
    const { helper, committed, restored } = setup();
    helper.schedule({ id: "a" });
    vi.advanceTimersByTime(1000);
    helper.schedule({ id: "b" });
    expect(helper.size).toBe(2);

    // Undo b; a's timer is untouched.
    helper.undo("b");
    expect(restored).toEqual(["b"]);

    vi.advanceTimersByTime(3000); // a hits its 4000 window (1000 + 3000)
    expect(committed).toEqual(["a"]);
    expect(helper.size).toBe(0);
  });

  it("flushAll commits every pending delete and clears their timers", () => {
    const { helper, committed } = setup();
    helper.schedule({ id: "a" });
    helper.schedule({ id: "b" });
    helper.schedule({ id: "c" });

    helper.flushAll();
    expect(committed.sort()).toEqual(["a", "b", "c"]);
    expect(helper.size).toBe(0);

    // Timers were cleared: advancing must not double-commit.
    vi.advanceTimersByTime(10_000);
    expect(committed.sort()).toEqual(["a", "b", "c"]);
  });

  it("uses injected timer functions when provided", () => {
    const setTimeoutFn = vi.fn((_h: () => void, _ms: number) => 42 as unknown as ReturnType<typeof setTimeout>);
    const clearTimeoutFn = vi.fn();
    const helper = createPendingDeletes<Rec>({
      idOf: (r) => r.id,
      delayMs: 4000,
      commit: () => {},
      restore: () => {},
      setTimeoutFn,
      clearTimeoutFn,
    });

    helper.schedule({ id: "a" });
    expect(setTimeoutFn).toHaveBeenCalledWith(expect.any(Function), 4000);

    helper.undo("a");
    expect(clearTimeoutFn).toHaveBeenCalledWith(42);
  });
});
