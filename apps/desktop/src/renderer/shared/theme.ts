export type Theme = "system" | "light" | "dark";
export type ThemeIconName = "theme-system" | "theme-light" | "theme-dark";

export const THEME_CYCLE: Theme[] = ["system", "light", "dark"];

export function nextTheme(current: Theme): Theme {
  const index = THEME_CYCLE.indexOf(current);
  // The modulo keeps the index in-bounds, so the lookup is always defined; the
  // assertion satisfies noUncheckedIndexedAccess (stricter than the old build).
  return THEME_CYCLE[(index + 1) % THEME_CYCLE.length]!;
}

export function themeIconName(theme: Theme): ThemeIconName {
  if (theme === "light") return "theme-light";
  if (theme === "dark") return "theme-dark";
  return "theme-system";
}
