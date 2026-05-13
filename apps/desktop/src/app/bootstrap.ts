// Bootstrap module — shared first-paint logic for the main and capsule
// webviews. The goal is to mount Svelte immediately and resolve real state
// in a single background round-trip so first paint never waits on IPC.
//
// Strategy:
//   1. Synchronously apply a cached theme + cached locale from localStorage
//      so the first frame doesn't flash between system-default and the
//      user's actual preferences.
//   2. The main window calls `startMainWindowBootstrap()`, which:
//        a. Marks the three big data stores (history / modes / dictionary) as
//           "started" with their empty initial value so any component that
//           subscribes before the snapshot resolves doesn't fan out a
//           duplicate `list_*` IPC.
//        b. Fires a single `get_app_snapshot` IPC. The result hydrates all
//           three stores and exposes settings via `appSnapshotReady()`.
//   3. The capsule window only needs cached chrome (`applyCachedChrome()`).
//      It doesn't subscribe to those stores at all.

import { changeLanguage } from "../i18n";
import { resolveLocale } from "../i18n/resolveLocale";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale, type LocalePreference } from "../i18n/types";
import { getAppSnapshot, type AppSnapshot } from "../ipc/snapshot";
import { historyStore } from "../ipc/historyStore";
import { modesStore } from "../features/modes/modesStore";
import { canonicalModeRecords } from "../features/modes/modes.ipc";
import { dictionaryStore } from "../features/dictionary/dictionaryStore";

const CACHED_THEME_KEY = "soto.cache.theme";
const CACHED_LOCALE_KEY = "soto.cache.locale";

const SUPPORTED_LOCALE_SET = new Set<string>(SUPPORTED_LOCALES);

function readCache(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeCache(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode / quota — best-effort */
  }
}

// Apply best-guess chrome (theme + locale) before mount. Safe to call once;
// idempotent.
export function applyCachedChrome(): void {
  const theme = readCache(CACHED_THEME_KEY) ?? "system";
  document.documentElement.setAttribute("data-theme", theme);

  const cachedLocale = readCache(CACHED_LOCALE_KEY);
  if (cachedLocale && SUPPORTED_LOCALE_SET.has(cachedLocale)) {
    document.documentElement.setAttribute("lang", cachedLocale);
    void changeLanguage(cachedLocale).catch((error) => console.warn("[soto-fe] bootstrap: cached language change failed:", error));
  } else {
    document.documentElement.setAttribute("lang", DEFAULT_LOCALE);
  }
}

// Shared snapshot promise for the main window. Initialised by
// `startMainWindowBootstrap()`; remains `null` for the capsule webview.
let appSnapshotPromise: Promise<AppSnapshot | null> | null = null;

export function startMainWindowBootstrap(): Promise<AppSnapshot | null> {
  if (appSnapshotPromise) return appSnapshotPromise;

  // Lock the lazy-fetch path on each store synchronously. Components that
  // subscribe between now and snapshot resolution will see the initial empty
  // value once, then the hydrated value as soon as the snapshot lands.
  historyStore.suppressLazyFetch();
  modesStore.suppressLazyFetch();
  dictionaryStore.suppressLazyFetch();

  appSnapshotPromise = getAppSnapshot()
    .then((snapshot) => {
      const settings = snapshot.settings;
      if (settings.theme && settings.theme !== document.documentElement.getAttribute("data-theme")) {
        document.documentElement.setAttribute("data-theme", settings.theme);
      }
      writeCache(CACHED_THEME_KEY, settings.theme);

      const resolved = resolveLocale(settings.locale as LocalePreference) as Locale;
      if (resolved !== document.documentElement.getAttribute("lang")) {
        void changeLanguage(resolved).catch((error) => console.warn("[soto-fe] bootstrap: language change failed:", error));
      }
      writeCache(CACHED_LOCALE_KEY, resolved);

      historyStore.hydrate(snapshot.history);
      modesStore.hydrate(canonicalModeRecords(snapshot.modes));
      dictionaryStore.hydrate(snapshot.dictionary);

      return snapshot;
    })
    .catch((error) => {
      console.warn("[soto-fe] bootstrap getAppSnapshot failed:", error);
      return null;
    });
  return appSnapshotPromise;
}

// Consumed by App.svelte and anything else in the main window that needs
// settings or anything else from the snapshot. Throws if accessed before
// `startMainWindowBootstrap()` has run — that's a bug in the entrypoint
// mount order, not a user-facing error.
export function appSnapshotReady(): Promise<AppSnapshot | null> {
  if (!appSnapshotPromise) {
    throw new Error(
      "appSnapshotReady() called before startMainWindowBootstrap(); fix the entrypoint mount order"
    );
  }
  return appSnapshotPromise;
}

// Convenience accessor — callers that only need settings (App.svelte's
// onboarding routing) get the settings field from the snapshot.
export async function appSettingsReady(): Promise<AppSnapshot["settings"] | null> {
  const snapshot = await appSnapshotReady();
  return snapshot?.settings ?? null;
}
