export interface LaunchAtLoginPort {
  isPackaged: boolean;
  platform: NodeJS.Platform;
  launchAtLogin: boolean;
  setLoginItemSettings(settings: { openAtLogin: boolean }): void;
  log?: (message: string) => void;
}

export function syncLaunchAtLogin(port: LaunchAtLoginPort): void {
  if (!port.isPackaged) return;
  if (port.platform !== "darwin" && port.platform !== "win32") return;

  try {
    port.setLoginItemSettings({ openAtLogin: port.launchAtLogin });
  } catch (error) {
    port.log?.(
      `[main] setLoginItemSettings(openAtLogin=${String(port.launchAtLogin)}) failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
