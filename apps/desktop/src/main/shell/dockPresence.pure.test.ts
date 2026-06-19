import { describe, expect, it } from "vitest";
import { resolveDockPresence, type DockPresenceInputs } from "./dockPresence.pure.js";

describe("resolveDockPresence", () => {
  const cases: Array<{
    name: string;
    input: DockPresenceInputs;
    expected: ReturnType<typeof resolveDockPresence>;
  }> = [
    {
      name: "keeps the macOS Dock icon for the default state",
      input: { platform: "darwin", settingHidesIcon: false, capsuleNeedsAccessory: false },
      expected: { activationPolicy: "regular", skipTaskbar: false, trayVisible: false },
    },
    {
      name: "uses accessory mode for a transient full-screen capsule on macOS",
      input: { platform: "darwin", settingHidesIcon: false, capsuleNeedsAccessory: true },
      expected: { activationPolicy: "accessory", skipTaskbar: false, trayVisible: false },
    },
    {
      name: "keeps macOS accessory mode and shows a tray when the setting hides the icon",
      input: { platform: "darwin", settingHidesIcon: true, capsuleNeedsAccessory: false },
      expected: { activationPolicy: "accessory", skipTaskbar: false, trayVisible: true },
    },
    {
      name: "does not reveal the macOS Dock icon while both inputs want accessory mode",
      input: { platform: "darwin", settingHidesIcon: true, capsuleNeedsAccessory: true },
      expected: { activationPolicy: "accessory", skipTaskbar: false, trayVisible: true },
    },
    {
      name: "leaves Windows activation policy alone and shows the existing tray",
      input: { platform: "win32", settingHidesIcon: false, capsuleNeedsAccessory: false },
      expected: { activationPolicy: null, skipTaskbar: false, trayVisible: true },
    },
    {
      name: "hides the Windows taskbar button when the setting is on",
      input: { platform: "win32", settingHidesIcon: true, capsuleNeedsAccessory: false },
      expected: { activationPolicy: null, skipTaskbar: true, trayVisible: true },
    },
    {
      name: "ignores capsule accessory need on Windows",
      input: { platform: "win32", settingHidesIcon: false, capsuleNeedsAccessory: true },
      expected: { activationPolicy: null, skipTaskbar: false, trayVisible: true },
    },
    {
      name: "is a no-op on Linux",
      input: { platform: "linux", settingHidesIcon: true, capsuleNeedsAccessory: true },
      expected: { activationPolicy: null, skipTaskbar: false, trayVisible: false },
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(resolveDockPresence(c.input)).toEqual(c.expected);
    });
  }
});
