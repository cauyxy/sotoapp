import {
  DEFAULT_LOCALE,
  LOCALE_REGISTRY,
  SUPPORTED_LOCALES,
  type Locale,
  type LocalePreference
} from "./types";

const SUPPORTED_SET = new Set<string>(SUPPORTED_LOCALES);

function defaultNavLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  const list = navigator.languages;
  if (Array.isArray(list) && list.length > 0) return list;
  if (typeof navigator.language === "string" && navigator.language.length > 0) {
    return [navigator.language];
  }
  return [];
}

export function resolveLocale(
  pref: LocalePreference,
  navLanguages: readonly string[] = defaultNavLanguages()
): Locale {
  if (pref !== "system") {
    return SUPPORTED_SET.has(pref) ? (pref as Locale) : DEFAULT_LOCALE;
  }
  for (const tag of navLanguages) {
    const lower = (tag ?? "").toLowerCase();
    if (lower.length === 0) continue;
    for (const locale of SUPPORTED_LOCALES) {
      if (LOCALE_REGISTRY[locale].systemPrefixes.some((p) => lower.startsWith(p))) {
        return locale;
      }
    }
  }
  return DEFAULT_LOCALE;
}
