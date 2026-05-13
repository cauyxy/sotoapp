import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./NetworkSettings.svelte", import.meta.url),
  "utf8"
);
const settingsPageSource = readFileSync(
  new URL("./SettingsPage.svelte", import.meta.url),
  "utf8"
);

describe("NetworkSettings", () => {
  it("imports getAppSettings and saveAppSettings", () => {
    expect(source).toMatch(/getAppSettings/);
    expect(source).toMatch(/saveAppSettings/);
  });

  it("references use_proxy from AppSettings", () => {
    expect(source).toMatch(/use_proxy/);
  });

  it("uses the i18n t function", () => {
    expect(source).toMatch(/from\s+["']\.\.\/\.\.\/i18n["']/);
    expect(source).toMatch(/\$t\(/);
  });

  it("renders a checkbox or toggle for the proxy setting", () => {
    expect(source).toMatch(/type="checkbox"|role="switch"/);
  });

  it("is rendered inside SettingsPage", () => {
    expect(settingsPageSource).toMatch(/NetworkSettings/);
  });
});
