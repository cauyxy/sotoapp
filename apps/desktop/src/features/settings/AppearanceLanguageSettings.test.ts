import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./AppearanceLanguageSettings.svelte", import.meta.url),
  "utf8"
);
const microphoneSource = readFileSync(new URL("./MicrophoneSettings.svelte", import.meta.url), "utf8");
const permissionSource = readFileSync(new URL("./PermissionSettings.svelte", import.meta.url), "utf8");
const settingsPageSource = readFileSync(new URL("./SettingsPage.svelte", import.meta.url), "utf8");
const aboutSource = readFileSync(new URL("./AboutSettings.svelte", import.meta.url), "utf8");

describe("AppearanceLanguageSettings", () => {
  it("imports the i18n module", () => {
    expect(source).toMatch(/from\s+["']\.\.\/\.\.\/i18n["']/);
  });

  it("imports resolveLocale and LOCALE_REGISTRY for the picker", () => {
    expect(source).toMatch(/resolveLocale/);
    expect(source).toMatch(/LOCALE_REGISTRY/);
    expect(source).toMatch(/SUPPORTED_LOCALES/);
  });

  it("calls changeLanguage after saving the preference", () => {
    expect(source).toMatch(/saveAppSettings\(/);
    const saveIdx = source.indexOf("saveAppSettings(");
    const changeIdx = source.indexOf("changeLanguage(");
    expect(changeIdx).toBeGreaterThan(-1);
    expect(saveIdx).toBeGreaterThan(-1);
    expect(changeIdx).toBeGreaterThan(saveIdx);
  });

  it("renders LOCALE_REGISTRY entries via nativeName so the picker is self-readable", () => {
    expect(source).toMatch(/LOCALE_REGISTRY\[[^\]]+\]\.nativeName/);
  });

  it("does not render duplicate section group titles inside settings panels", () => {
    expect(source).not.toMatch(/settings\.appearance\.groupTitle/);
    expect(microphoneSource).not.toMatch(/settings\.microphone\.groupTitle/);
    expect(aboutSource).not.toMatch(/settings\.about\.groupTitle/);
  });

  it("keeps Appearance focused on theme and interface language", () => {
    expect(source).not.toMatch(/transcription_language_hint/);
    expect(source).not.toMatch(/settings\.appearance\.transcription/);
  });

  it("keeps permission status visible from Settings", () => {
    expect(settingsPageSource).toMatch(/PermissionSettings/);
    expect(permissionSource).toMatch(/listPermissionStatuses/);
    expect(permissionSource).toMatch(/requestPermissionAuthorization/);
  });

  it("renders Permissions above Microphone in Settings", () => {
    const permissionsIndex = settingsPageSource.indexOf("<PermissionSettings");
    const microphoneIndex = settingsPageSource.indexOf("<MicrophoneSettings");
    expect(permissionsIndex).toBeGreaterThan(-1);
    expect(microphoneIndex).toBeGreaterThan(-1);
    expect(permissionsIndex).toBeLessThan(microphoneIndex);
  });

  it("does not render the page table of contents in Settings", () => {
    expect(settingsPageSource).not.toMatch(/SettingsToc/);
  });

  it("routes every permission action through requestPermissionAuthorization (no in-app overlay)", () => {
    expect(permissionSource).not.toMatch(/startPermissionOverlay/);
    expect(permissionSource).not.toMatch(/AUTHORIZATION_PANES/);
    expect(permissionSource).not.toMatch(/permission-grant-card/);
    expect(permissionSource).toMatch(/requestPermissionAuthorization/);
    expect(permissionSource).toMatch(/subscribePermissionUpdates/);
    expect(permissionSource).toMatch(/toast\(permissionMessage\)/);
  });
});
