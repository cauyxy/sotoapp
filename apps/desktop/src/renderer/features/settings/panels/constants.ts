// Section order + label keys for the Settings page — ported from the old
// features/settings/constants.ts. The page renders these top to bottom; the
// Permissions section is macOS-only (gated in SettingsPage by isMacOS()).

export const SETTINGS_SECTIONS = [
  "Permissions",
  "Microphone",
  "Network",
  "General",
  "About",
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const SETTINGS_SECTION_LABEL_KEY = {
  Microphone: "settings.nav.microphone",
  Permissions: "settings.nav.permissions",
  Network: "settings.nav.network",
  General: "settings.nav.general",
  About: "settings.nav.about",
} as const satisfies Record<SettingsSection, string>;

/** macOS-only gate for the Permissions section (was app/platform isMacOS()). */
export function isMacOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform = navigator.platform ?? "";
  const ua = navigator.userAgent ?? "";
  return /Mac/i.test(platform) || /Mac OS X/i.test(ua);
}
