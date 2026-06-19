// Soto i18n (React port of the old Svelte i18next store). The old build wrapped
// i18next in a Svelte readable store so `$t('key')` re-rendered on language
// change. Here we keep the same nested locale maps and `{{var}}` interpolation
// but drop the i18next dependency: a tiny dot-path lookup + interpolation is
// enough for our flat string catalog, and the React Context (see i18n/context)
// provides the reactive `useT()` the components subscribe to.

import enMessages from "./locales/en-US";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type Locale,
  type Messages
} from "./types";

const EAGER: Partial<Record<Locale, Messages>> = {
  "en-US": enMessages
};

const LOADERS: Record<Locale, () => Promise<{ default: Messages }>> = {
  "en-US": () => Promise.resolve({ default: enMessages }),
  "zh-CN": () => import("./locales/zh-CN")
};

export type TranslateOptions = Record<string, string | number | boolean>;

// Soto translator: takes any string key (canonical for runtime-built keys like
// `capsule.aria.${state}`) and resolves it against the active locale's nested
// message map. We trade i18next's strict literal-key type-check for runtime
// flexibility because most of our keys are composed at use-site — matching the
// old build's `Translator` contract exactly.
export type Translator = (key: string, options?: TranslateOptions) => string;

function lookup(messages: Messages, key: string): string | undefined {
  let node: unknown = messages;
  for (const part of key.split(".")) {
    if (node !== null && typeof node === "object" && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof node === "string" ? node : undefined;
}

function interpolate(template: string, options?: TranslateOptions): string {
  if (!options) return template;
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, name: string) => {
    const value = options[name];
    return value === undefined ? match : String(value);
  });
}

/** Synchronously available messages for a locale, or the default if not yet loaded. */
export function messagesFor(locale: Locale): Messages {
  return EAGER[locale] ?? EAGER[DEFAULT_LOCALE]!;
}

/** Kick off loading a non-eager locale; resolves when it is available synchronously. */
export async function ensureLocale(locale: Locale): Promise<void> {
  if (EAGER[locale]) return;
  const mod = await LOADERS[locale]();
  EAGER[locale] = mod.default;
}

/** Build a translator bound to a specific locale (fallback to DEFAULT_LOCALE). */
export function buildTranslator(locale: Locale): Translator {
  const primary = messagesFor(locale);
  const fallback = messagesFor(DEFAULT_LOCALE);
  return (key, options) => {
    const hit = lookup(primary, key) ?? lookup(fallback, key) ?? key;
    return interpolate(hit, options);
  };
}

export function isSupportedLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export { DEFAULT_LOCALE, SUPPORTED_LOCALES };
export type { Locale, Messages };
