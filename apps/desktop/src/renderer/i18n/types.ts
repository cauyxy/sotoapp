export const SUPPORTED_LOCALES = ["en-US", "zh-CN"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export type LocalePreference = "system" | Locale;

export const DEFAULT_LOCALE: Locale = "en-US";

export const LOCALE_REGISTRY: Record<Locale, {
  nativeName: string;
  systemPrefixes: readonly string[];
}> = {
  "en-US": { nativeName: "English", systemPrefixes: ["en"] },
  "zh-CN": { nativeName: "中文", systemPrefixes: ["zh"] }
};

// Sidebar language toggle cycle: System → English → 中文 (mirrors THEME_CYCLE in
// shared/theme.ts). nextLocale wraps; an unknown current falls back to "system".
export const LOCALE_CYCLE: LocalePreference[] = ["system", ...SUPPORTED_LOCALES];

export function nextLocale(current: LocalePreference): LocalePreference {
  const index = LOCALE_CYCLE.indexOf(current);
  return LOCALE_CYCLE[(index + 1) % LOCALE_CYCLE.length]!;
}

export type { Messages } from "./locales/en-US";
