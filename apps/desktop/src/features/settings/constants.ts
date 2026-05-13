export const SETTINGS_SECTIONS = [
  "Permissions",
  "Microphone",
  "Engine",
  "Network",
  "Appearance & Language",
  "About"
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const SETTINGS_SECTION_LABEL_KEY = {
  Microphone: "settings.nav.microphone",
  Permissions: "settings.nav.permissions",
  Engine: "settings.nav.engine",
  Network: "settings.nav.network",
  "Appearance & Language": "settings.nav.appearanceLanguage",
  About: "settings.nav.about"
} as const satisfies Record<SettingsSection, string>;

export const SETTINGS_GROUPED = [
  {
    groupKey: "settings.nav.basics",
    items: [
      { id: "Permissions", labelKey: SETTINGS_SECTION_LABEL_KEY.Permissions },
      { id: "Microphone", labelKey: SETTINGS_SECTION_LABEL_KEY.Microphone }
    ]
  },
  {
    groupKey: "settings.nav.abilities",
    items: [{ id: "Engine", labelKey: SETTINGS_SECTION_LABEL_KEY.Engine }]
  },
  {
    groupKey: "settings.nav.system",
    items: [
      { id: "Network", labelKey: SETTINGS_SECTION_LABEL_KEY.Network },
      { id: "Appearance & Language", labelKey: SETTINGS_SECTION_LABEL_KEY["Appearance & Language"] },
      { id: "About", labelKey: SETTINGS_SECTION_LABEL_KEY.About }
    ]
  }
] as const satisfies readonly {
  groupKey: string;
  items: readonly { id: SettingsSection; labelKey: string }[];
}[];
