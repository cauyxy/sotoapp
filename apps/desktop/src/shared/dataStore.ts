import { writable, type Subscriber, type Unsubscriber, type Writable } from "svelte/store";

// Lazy-refresh data store. Implements the Svelte `Writable<T>` contract
// (`subscribe`, `set`, `update`) plus a `refresh()` method that re-runs the
// fetcher. First subscribe triggers an automatic refresh, unless
// `suppressLazyFetch()` (or `hydrate()`) has already been called — in which
// case the caller is taking ownership of priming the data, typically from a
// single `get_app_snapshot` IPC round-trip at boot.
export interface DataStore<T> extends Writable<T> {
  refresh: () => Promise<T>;
  /** Set the value without triggering a fetch, and mark the store started so
   *  the lazy-fetch-on-first-subscribe path is suppressed. Idempotent. */
  hydrate: (value: T) => void;
  /** Mark the store started without changing its value. Useful when boot is
   *  in flight but hasn't resolved yet — components subscribing in that
   *  window see the initial value and don't fan out duplicate IPC calls. */
  suppressLazyFetch: () => void;
}

export function createDataStore<T>(fetcher: () => Promise<T>, initial: T): DataStore<T> {
  const inner = writable<T>(initial);
  let pending: Promise<T> | null = null;
  let started = false;

  function refresh(): Promise<T> {
    if (pending) return pending;
    pending = fetcher()
      .then((next) => {
        inner.set(next);
        return next;
      })
      .finally(() => {
        pending = null;
      });
    started = true;
    return pending;
  }

  function subscribe(run: Subscriber<T>, invalidate?: (value?: T) => void): Unsubscriber {
    const unsub = inner.subscribe(run, invalidate);
    if (!started) {
      started = true;
      void refresh().catch((error) => {
        console.error("dataStore: initial fetch failed", error);
      });
    }
    return unsub;
  }

  function hydrate(value: T): void {
    inner.set(value);
    started = true;
  }

  function suppressLazyFetch(): void {
    started = true;
  }

  return {
    subscribe,
    set: inner.set,
    update: inner.update,
    refresh,
    hydrate,
    suppressLazyFetch
  };
}
