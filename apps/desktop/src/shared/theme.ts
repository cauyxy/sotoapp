export type Theme = "system" | "light" | "dark";
export type ThemeIconName = "theme-system" | "theme-light" | "theme-dark";

export const THEME_CYCLE: Theme[] = ["system", "light", "dark"];

export function nextTheme(current: Theme): Theme {
  const index = THEME_CYCLE.indexOf(current);
  return THEME_CYCLE[(index + 1) % THEME_CYCLE.length];
}

export function themeIconName(theme: Theme): ThemeIconName {
  if (theme === "light") return "theme-light";
  if (theme === "dark") return "theme-dark";
  return "theme-system";
}
