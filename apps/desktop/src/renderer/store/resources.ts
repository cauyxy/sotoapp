// AppResources — the renderer's single data layer over the main-process
// AppModel (plan §4.4). It owns the load/refresh/mutation lifecycle so pages
// stop each owning their own boot-hydrate + reload + fallback. Framework-free
// (a subscribe/getSnapshot controller, no React) so it is unit-testable in Node
// and binds via useSyncExternalStore in the AppResourcesProvider (Phase 2).
//
// Responsibilities:
//  - hold a Loadable<AppModel>,
//  - loadInitial() once at boot (or report `unavailable` with no bridge),
//  - refresh(reason) to re-pull the model (e.g. after a mutation),
//  - mutate(action) to run an IPC command then refresh,
//  - merge runtime events: a terminal voice-runtime event refreshes the model
//    so recentHistory + readiness stay current after a dictation completes.

import type { AppModel, RefreshReason } from "../ipc";

export type Loadable<T> =
  | { status: "loading" }
  | { status: "ready"; model: T }
  | { status: "error"; message: string }
  // The window.soto bridge is missing (e.g. preload failed) — no fetch is
  // possible, so this is a distinct terminal state, not a transient error.
  | { status: "unavailable" };

// RefreshReason is canonical in @soto/core (it crosses the IPC boundary as the
// get_app_model scope hint); re-exported so existing import sites keep working.
export type { RefreshReason };

export interface AppResourcesDeps {
  /** Fetch the aggregated app model (renderer ipc.getAppModel). The reason
   * scopes the main-side refresh (e.g. skip re-enumerating microphones). */
  getAppModel: (reason?: RefreshReason) => Promise<AppModel>;
  /** Subscribe to main->renderer voice-runtime events; returns an unsubscribe. */
  onVoiceRuntime: (cb: (payload: unknown) => void) => () => void;
  /** Whether the window.soto bridge is present. */
  hasBridge: () => boolean;
}

export interface AppResources {
  getSnapshot(): Loadable<AppModel>;
  subscribe(listener: () => void): () => void;
  loadInitial(): Promise<void>;
  refresh(reason?: RefreshReason): Promise<void>;
  /** Run an IPC mutation then refresh the model. Rejections propagate (the page
   * surfaces them); the model is only refreshed on success. */
  mutate<T>(action: () => Promise<T>, reason?: RefreshReason): Promise<T>;
  /** Tear down the runtime-event subscription. */
  dispose(): void;
}

const TERMINAL_VOICE_KINDS: ReadonlySet<string> = new Set(["completed", "cancelled", "failed"]);

function isTerminalVoiceEvent(payload: unknown): boolean {
  if (typeof payload !== "object" || payload === null) return false;
  const kind = (payload as { kind?: unknown }).kind;
  return typeof kind === "string" && TERMINAL_VOICE_KINDS.has(kind);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createAppResources(deps: AppResourcesDeps): AppResources {
  let snapshot: Loadable<AppModel> = { status: "loading" };
  const listeners = new Set<() => void>();

  function setSnapshot(next: Loadable<AppModel>): void {
    snapshot = next;
    for (const listener of listeners) listener();
  }

  async function fetchInto(onErrorKeepReady: boolean, reason?: RefreshReason): Promise<void> {
    if (!deps.hasBridge()) {
      setSnapshot({ status: "unavailable" });
      return;
    }
    try {
      const model = await deps.getAppModel(reason);
      setSnapshot({ status: "ready", model });
    } catch (error) {
      // A failed refresh over an already-loaded model is treated as transient:
      // keep the last good model rather than blanking the UI. A failed initial
      // load has nothing to fall back to, so it surfaces the error.
      if (onErrorKeepReady && snapshot.status === "ready") return;
      setSnapshot({ status: "error", message: errorMessage(error) });
    }
  }

  // A completed/cancelled/failed dictation changes recentHistory + readiness;
  // refresh once loaded so Home + History reflect it without page-local reloads.
  const unsubscribeVoice = deps.onVoiceRuntime((payload) => {
    if (snapshot.status === "ready" && isTerminalVoiceEvent(payload)) {
      void fetchInto(true, "voice-terminal");
    }
  });

  return {
    getSnapshot(): Loadable<AppModel> {
      return snapshot;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async loadInitial(): Promise<void> {
      await fetchInto(false, "initial");
    },
    async refresh(reason?: RefreshReason): Promise<void> {
      await fetchInto(true, reason);
    },
    async mutate<T>(action: () => Promise<T>, reason?: RefreshReason): Promise<T> {
      const result = await action();
      await this.refresh(reason);
      return result;
    },
    dispose(): void {
      unsubscribeVoice();
      listeners.clear();
    },
  };
}
