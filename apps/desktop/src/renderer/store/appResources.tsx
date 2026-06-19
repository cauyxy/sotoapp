// The main window's single AppResources instance + its React binding (plan
// §4.4 / Phase 2). Lives in store/ (not app/) because feature pages consume the
// hooks and the renderer layering forbids features -> app imports; store/ is the
// features-importable renderer-state layer (alongside appStore). The pure
// controller factory is store/resources.ts; this module owns the live singleton
// (which subscribes to IPC events) and the React provider/hooks.
//
// onVoiceRuntime is guarded by hasBridge so constructing the singleton without a
// preload bridge (non-GUI/test runtimes) is a no-op rather than throwing.

import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import type { AppSettings } from "@soto/core";

import { getAppModel, hasBridge, onVoiceRuntime, saveAppSettings, type AppModel } from "../ipc";
import { createAppResources, type AppResources, type Loadable } from "./resources";

export const appResources: AppResources = createAppResources({
  getAppModel,
  onVoiceRuntime: (cb) => (hasBridge() ? onVoiceRuntime(cb) : () => {}),
  hasBridge,
});

// Default to the singleton so the hooks work even without an explicit provider
// (one main window / one instance); the provider's job is the mount-time load.
const AppResourcesContext = createContext<AppResources>(appResources);

export function AppResourcesProvider({ children }: { children: ReactNode }): JSX.Element {
  useEffect(() => {
    // Single boot round-trip (get_app_model). The singleton lives for the whole
    // window lifetime, so we intentionally do NOT dispose on unmount — that
    // would tear down the voice-runtime refresh subscription.
    void appResources.loadInitial();
  }, []);

  return (
    <AppResourcesContext.Provider value={appResources}>{children}</AppResourcesContext.Provider>
  );
}

/** The AppResources controller (for refresh / mutate). */
export function useAppResources(): AppResources {
  return useContext(AppResourcesContext);
}

/** The full Loadable state (the App shell gates boot on this). */
export function useAppModelState(): Loadable<AppModel> {
  const resources = useAppResources();
  return useSyncExternalStore(resources.subscribe, resources.getSnapshot);
}

/** The loaded AppModel, or null until it is ready. */
export function useAppModel(): AppModel | null {
  const state = useAppModelState();
  return state.status === "ready" ? state.model : null;
}

/**
 * Persist a partial AppSettings patch: merge it onto the loaded model's
 * settings, save, then refresh the model. The single write path for every
 * settings toggle (theme/locale chrome, microphone, proxy) so no caller
 * hand-rolls the spread-and-mutate dance. No-op before the model is ready —
 * there is no settings base to merge onto (matches the previous per-caller
 * guards). Rejections propagate; the model is unchanged on failure.
 */
export async function mutateAppSettings(
  resources: AppResources,
  patch: Partial<AppSettings>,
): Promise<void> {
  const snapshot = resources.getSnapshot();
  if (snapshot.status !== "ready") return;
  await resources.mutate(
    () => saveAppSettings({ ...snapshot.model.settings, ...patch }),
    "settings",
  );
}
