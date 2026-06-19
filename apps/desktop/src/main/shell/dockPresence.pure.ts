export type ActivationPolicy = "regular" | "accessory";

export interface DockPresenceInputs {
  platform: NodeJS.Platform;
  settingHidesIcon: boolean;
  capsuleNeedsAccessory: boolean;
}

export interface DockPresence {
  activationPolicy: ActivationPolicy | null;
  skipTaskbar: boolean;
  trayVisible: boolean;
}

export function resolveDockPresence(input: DockPresenceInputs): DockPresence {
  const { platform, settingHidesIcon, capsuleNeedsAccessory } = input;

  if (platform === "darwin") {
    const accessory = settingHidesIcon || capsuleNeedsAccessory;
    return {
      activationPolicy: accessory ? "accessory" : "regular",
      skipTaskbar: false,
      trayVisible: settingHidesIcon,
    };
  }

  if (platform === "win32") {
    return {
      activationPolicy: null,
      skipTaskbar: settingHidesIcon,
      trayVisible: true,
    };
  }

  return { activationPolicy: null, skipTaskbar: false, trayVisible: false };
}
