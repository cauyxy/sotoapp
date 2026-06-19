// React access path mirroring the old Svelte `$t` store. The provider derives
// the active locale from the app store (resolving "system" against the OS) and
// memoises a translator; `useT()` returns that translator and re-renders
// consumers whenever the locale changes — same ergonomics as `$t('key')`.

import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from "react";

import { buildTranslator, ensureLocale, type Translator } from "./index";
import { resolveLocale } from "./resolveLocale";
import { type Locale } from "./types";
import { useAppStore } from "../store/appStore";

interface I18nContextValue {
  t: Translator;
  locale: Locale;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }): JSX.Element {
  const localePref = useAppStore((s) => s.locale);
  const locale = useMemo<Locale>(() => resolveLocale(localePref), [localePref]);
  const [localeVersion, bumpLocaleVersion] = useReducer((n: number) => n + 1, 0);
  const t = useMemo<Translator>(() => buildTranslator(locale), [locale, localeVersion]);

  useEffect(() => {
    let alive = true;
    void ensureLocale(locale).then(() => {
      if (alive) bumpLocaleVersion();
    });
    return () => {
      alive = false;
    };
  }, [locale]);

  // Keep <html lang> in sync so the unicode-range font split picks the right
  // CJK / Latin face — same effect the old i18next `languageChanged` handler had.
  useEffect(() => {
    document.documentElement.setAttribute("lang", locale);
  }, [locale]);

  const value = useMemo<I18nContextValue>(() => ({ t, locale }), [t, locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (ctx === null) {
    throw new Error("useI18n() called outside <I18nProvider>");
  }
  return ctx;
}

/** Reactive translator hook — the React analogue of the old `$t` store. */
export function useT(): Translator {
  return useI18n().t;
}
