// Soto i18n: i18next core wrapped in a Svelte readable store so templates
// re-render on language changes via `$t('key')` / `$lang`.
import i18next, { type TOptions } from "i18next";
import { readable, type Readable } from "svelte/store";

import enMessages from "./locales/en-US";
import zhMessages from "./locales/zh-CN";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type Locale,
  type Messages
} from "./types";

const resources: Record<Locale, { translation: Messages }> = {
  "en-US": { translation: enMessages },
  "zh-CN": { translation: zhMessages }
};

void i18next.init({
  resources,
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: [...SUPPORTED_LOCALES],
  interpolation: { escapeValue: false },
  returnNull: false
});

i18next.on("languageChanged", (lng) => {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("lang", lng);
  }
});

// Soto translator: takes any string key (canonical for runtime-built keys like
// `capsule.aria.${state}`) and forwards to i18next. We trade i18next's strict
// literal-key type-check for runtime flexibility because most of our keys are
// composed at use-site.
export type Translator = (key: string, options?: TOptions | Record<string, unknown>) => string;

function buildTranslator(): Translator {
  // A fresh closure per call so the Svelte readable store sees a new value on
  // `languageChanged` and notifies subscribers.
  return (key, options) =>
    (i18next.t as unknown as (k: string, o?: TOptions | Record<string, unknown>) => string)(key, options);
}

// Live translator: subscribed components re-render after `languageChanged`.
export const t: Readable<Translator> = readable<Translator>(buildTranslator(), (set) => {
  function update() {
    set(buildTranslator());
  }
  i18next.on("languageChanged", update);
  i18next.on("loaded", update);
  return () => {
    i18next.off("languageChanged", update);
    i18next.off("loaded", update);
  };
});

export const lang: Readable<string> = readable<string>(i18next.language || DEFAULT_LOCALE, (set) => {
  function update(lng: string) {
    set(lng);
  }
  i18next.on("languageChanged", update);
  return () => {
    i18next.off("languageChanged", update);
  };
});

export async function changeLanguage(next: string): Promise<void> {
  await i18next.changeLanguage(next);
}

// Imperative translator. Reads i18next.t at call-time, so it always returns
// the current language's copy. Use inside event handlers or non-reactive code.
export const translate: Translator = (key, options) =>
  (i18next.t as unknown as (k: string, o?: TOptions | Record<string, unknown>) => string)(key, options);

export default i18next;
