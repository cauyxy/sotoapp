// Deferred-commit ("undo") bookkeeping for single history deletions, factored
// out of HistoryPage so the timer/commit/undo/flush state machine is unit-
// testable without React, IPC, or the alert singleton. Pure: every side effect
// (the real delete, the UI restore) is injected; timers are injectable too so a
// test can drive them with fake timers.
//
// Contract: a scheduled record is "pending" until either its timer fires (the
// commit runs) or undo() cancels it (the restore runs). flushAll() commits every
// still-pending record at once (used on unmount so a deleted row isn't
// resurrected by navigating away). Concurrent deletes are independent — each
// record id owns its own timer entry.

export interface PendingDeletesOptions<T> {
  /** Stable identity for a record. */
  idOf: (record: T) => string;
  /** Window before a scheduled delete commits, in ms. */
  delayMs: number;
  /** Commit the delete for real (IPC). Invoked on timer expiry and on flush. */
  commit: (record: T) => void;
  /** Put a record back into the UI (undo). */
  restore: (record: T) => void;
  /** Injectable timer seam (defaults to the global functions). */
  setTimeoutFn?: (handler: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void;
}

export interface PendingDeletes<T> {
  /**
   * Begin deferring a delete. Returns false (a no-op) if this id is already
   * pending, so a repeat click can't double-schedule. Otherwise arms a timer
   * that commits the record after `delayMs`.
   */
  schedule: (record: T) => boolean;
  /** Is this id currently mid-undo? */
  has: (id: string) => boolean;
  /**
   * Cancel a pending delete and restore the record. Returns false if the id is
   * not pending (e.g. already committed), in which case nothing is restored.
   */
  undo: (id: string) => boolean;
  /** Commit every still-pending delete now and clear all timers (unmount flush). */
  flushAll: () => void;
  /** Number of currently pending deletes. */
  readonly size: number;
}

export function createPendingDeletes<T>(options: PendingDeletesOptions<T>): PendingDeletes<T> {
  const { idOf, delayMs, commit, restore } = options;
  const setTimeoutFn = options.setTimeoutFn ?? ((h, ms) => setTimeout(h, ms));
  const clearTimeoutFn = options.clearTimeoutFn ?? ((handle) => clearTimeout(handle));

  const pending = new Map<string, { record: T; timer: ReturnType<typeof setTimeout> }>();

  function expire(id: string): void {
    const entry = pending.get(id);
    if (entry === undefined) return;
    pending.delete(id);
    commit(entry.record);
  }

  return {
    schedule(record: T): boolean {
      const id = idOf(record);
      if (pending.has(id)) return false;
      const timer = setTimeoutFn(() => expire(id), delayMs);
      pending.set(id, { record, timer });
      return true;
    },
    has(id: string): boolean {
      return pending.has(id);
    },
    undo(id: string): boolean {
      const entry = pending.get(id);
      if (entry === undefined) return false;
      clearTimeoutFn(entry.timer);
      pending.delete(id);
      restore(entry.record);
      return true;
    },
    flushAll(): void {
      // Snapshot first: commit() may mutate the map (e.g. restore-on-error).
      const entries = [...pending.values()];
      pending.clear();
      for (const entry of entries) {
        clearTimeoutFn(entry.timer);
        commit(entry.record);
      }
    },
    get size(): number {
      return pending.size;
    },
  };
}
