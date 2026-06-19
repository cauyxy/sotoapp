export type WindowThemeSource = "system" | "light" | "dark";

export function overlaySymbolColor(isDark: boolean): string {
  return isDark ? "#ECEAE3" : "#1A1D22";
}

export function isWindowThemeSource(theme: unknown): theme is WindowThemeSource {
  return theme === "light" || theme === "dark" || theme === "system";
}

export function themeSourceFor(theme: unknown): WindowThemeSource {
  if (isWindowThemeSource(theme)) return theme;
  return "system";
}
