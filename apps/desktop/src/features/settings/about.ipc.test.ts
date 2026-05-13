import { beforeEach, describe, expect, it, vi } from "vitest";

import { aboutPanel, checkForUpdates, updateStatusMessage } from "./about.ipc";

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn()
}));

import { check } from "@tauri-apps/plugin-updater";
const mockCheck = vi.mocked(check);

describe("aboutPanel", () => {
  it("builds the colophon About panel from the app version", () => {
    expect(aboutPanel({ version: "0.1.0" })).toEqual({
      appName: "Soto",
      versionLabel: "0.1.0",
      repositoryUrl: "https://github.com/cauyxy/sotoapp",
      repositoryLabel: "github.com/cauyxy/sotoapp"
    });
  });
});

describe("updateStatusMessage", () => {
  it.each([
    ["checking", "settings.about.updateChecking"],
    ["up-to-date", "settings.about.updateUpToDate"],
    ["installing", "settings.about.updateInstalling"],
    ["failed", "settings.about.updateFailed"]
  ] as const)("maps '%s' to the correct i18n key", (status, expected) => {
    expect(updateStatusMessage(status)).toBe(expected);
  });
});

describe("checkForUpdates", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null when no update is available", async () => {
    mockCheck.mockResolvedValue(null);
    expect(await checkForUpdates()).toBeNull();
  });

  it("returns the update object when an update is available", async () => {
    const mockUpdate = { available: true, version: "1.0.0" };
    mockCheck.mockResolvedValue(mockUpdate as never);
    expect(await checkForUpdates()).toEqual(mockUpdate);
  });
});
