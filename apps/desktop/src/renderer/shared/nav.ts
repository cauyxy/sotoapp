export const NAV_ITEMS = ["Home", "History", "Modes", "Dictionary", "Models", "Settings"] as const;
export type NavItem = (typeof NAV_ITEMS)[number];

export const NAV_LABEL_KEY = {
  Home: "sidebar.home",
  History: "sidebar.history",
  Modes: "sidebar.modes",
  Dictionary: "sidebar.dictionary",
  Models: "sidebar.models",
  Settings: "sidebar.settings"
} as const satisfies Record<NavItem, string>;

const FALLBACK_WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
] as const;

export function currentDateKicker(now: Date, weekdayLabels?: readonly string[]): string {
  const locale = (typeof navigator !== "undefined" && navigator.language) || "zh-CN";
  const weekday = (weekdayLabels ?? FALLBACK_WEEKDAYS)[now.getDay()];
  if (locale.startsWith("zh")) {
    return `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日 · ${weekday}`;
  }
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}.${mm}.${dd} · ${weekday}`;
}
