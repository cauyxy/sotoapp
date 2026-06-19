// Renderer SHELL store (zustand) — nav + theme + locale only. Business data
// (settings / modes / history / dictionary / providers / permissions / ...) now
// lives in AppResources (store/resources.ts), loaded once via get_app_model. This
// store holds only the chrome state the shell owns; it no longer carries a boot
// snapshot, so shell state and business data are no longer co-mingled.
//
// Theme + locale are cached in localStorage for flash-free first paint; the text
// scale stays at the CSS default until the persisted AppSettings load. All three
// are reconciled in reconcileChromeFromSettings, called by App when the model is
// first ready.
// A *changed* theme/locale is persisted back to AppSettings via the AppResources
// model as the save base (persistChrome); the sidebar toggles are the only
// chrome mutators (the Appearance & Language settings panel was removed).

import { create } from "zustand";

import type { AppSettings } from "@soto/core";
import { type NavItem } from "../shared/nav";
import { nextTheme, type Theme } from "../shared/theme";
import { hasBridge, setWindowTheme } from "../ipc";
import { appResources, mutateAppSettings } from "./appResources";
import { nextLocale, type LocalePreference } from "../i18n/types";
import { isSupportedLocale } from "../i18n";
import { textScaleMultiplier, type TextScale } from "./textScale";

const CACHED_THEME_KEY = "soto.cache.theme";
const CACHED_LOCALE_KEY = "soto.cache.locale";

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

function cachedTheme(): Theme {
  const value = readCache(CACHED_THEME_KEY);
  if (value === "light" || value === "dark" || value === "system") return value;
  return "system";
}

function cachedLocale(): LocalePreference {
  const value = readCache(CACHED_LOCALE_KEY);
  if (value === "system") return "system";
  if (value !== null && isSupportedLocale(value)) return value;
  return "system";
}

/** Apply theme to <html data-theme> — the single CSS theming hook. */
export function applyThemeAttribute(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  if (hasBridge()) setWindowTheme(theme);
}

export function applyTextScaleAttribute(scale: TextScale): void {
  document.documentElement.style.setProperty(
    "--soto-text-scale",
    String(textScaleMultiplier(scale)),
  );
}

interface AppState {
  // Navigation
  view: NavItem;
  setView: (view: NavItem) => void;

  // Theme
  theme: Theme;
  setTheme: (theme: Theme) => void;
  cycleTheme: () => void;

  // Locale (preference; "system" resolved by resolveLocale at read sites)
  locale: LocalePreference;
  setLocale: (locale: LocalePreference) => void;
  cycleLocale: () => void;
}

// Pure selectors over the shell state — named + unit-testable without a React
// renderer. The hooks below are thin zustand subscriptions over them.
export const selectView = (s: AppState): NavItem => s.view;
export const selectTheme = (s: AppState): Theme => s.theme;

export const useAppStore = create<AppState>((set, get) => ({
  view: "Home",
  setView: (view) => set({ view }),

  theme: cachedTheme(),
  setTheme: (theme) => {
    applyThemeAttribute(theme);
    writeCache(CACHED_THEME_KEY, theme);
    set({ theme });
    persistChrome({ theme });
  },
  cycleTheme: () => {
    get().setTheme(nextTheme(get().theme));
  },

  locale: cachedLocale(),
  setLocale: (locale) => {
    writeCache(CACHED_LOCALE_KEY, locale);
    set({ locale });
    persistChrome({ locale });
  },
  cycleLocale: () => {
    get().setLocale(nextLocale(get().locale));
  },
}));

/**
 * Reconcile the optimistic cached chrome with the persisted AppSettings once the
 * AppModel loads — the DB settings win over the cache (parity with the old boot
 * reconciliation). Called by App when the model first becomes ready.
 */
export function reconcileChromeFromSettings(
  settings: Pick<AppSettings, "theme" | "locale" | "base_text_scale">,
): void {
  applyTextScaleAttribute(settings.base_text_scale);
  const settingsTheme = settings.theme;
  if (settingsTheme === "light" || settingsTheme === "dark" || settingsTheme === "system") {
    applyThemeAttribute(settingsTheme);
    writeCache(CACHED_THEME_KEY, settingsTheme);
    useAppStore.setState({ theme: settingsTheme });
  }
  const settingsLocale = settings.locale;
  if (settingsLocale === "system" || isSupportedLocale(settingsLocale)) {
    writeCache(CACHED_LOCALE_KEY, settingsLocale);
    useAppStore.setState({ locale: settingsLocale as LocalePreference });
  }
}

// Persist a theme/locale change to AppSettings, merged onto the loaded AppModel's
// settings, then refresh the model so it reflects the change. Without this a
// choice would live only in the localStorage cache and be overwritten by the
// persisted DB value on the next boot. Cache-only (no DB write) when the bridge
// is missing or the model has not loaded yet — matching the old snapshot-absent
// behaviour.
//
// Persists are SERIALIZED: a rapid second toggle (theme then locale) runs only
// after the first save's model refresh, so it reads the post-first-save settings
// as its base rather than a stale snapshot that would clobber the first write.
// Each step re-reads the freshest model settings, so a concurrent non-chrome
// settings change is preserved too.
let chromePersistChain: Promise<void> = Promise.resolve();
function persistChrome(patch: Partial<Pick<AppSettings, "theme" | "locale">>): void {
  if (!hasBridge()) return;
  chromePersistChain = chromePersistChain
    // mutateAppSettings is a no-op before the model loads → cache-only, as before.
    .then(() => mutateAppSettings(appResources, patch))
    .catch((error) => console.warn("[soto-fe] persist theme/locale failed:", error));
}

// Memoized selector hooks (the reads consumers should use).
export const useView = (): NavItem => useAppStore(selectView);
export const useTheme = (): Theme => useAppStore(selectTheme);
