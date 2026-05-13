import { check, type Update } from "@tauri-apps/plugin-updater";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "installing"
  | "failed";

export function updateStatusMessage(
  status: "checking" | "up-to-date" | "installing" | "failed"
): string {
  const map = {
    checking: "settings.about.updateChecking",
    "up-to-date": "settings.about.updateUpToDate",
    installing: "settings.about.updateInstalling",
    failed: "settings.about.updateFailed"
  } as const;
  return map[status];
}

export async function checkForUpdates(): Promise<Update | null> {
  return check();
}

export interface AboutPanelSource {
  version: string;
}

export interface AboutPanel {
  appName: string;
  versionLabel: string;
  repositoryUrl: string;
  repositoryLabel: string;
}

export function aboutPanel(source: AboutPanelSource): AboutPanel {
  return {
    appName: "Soto",
    versionLabel: source.version,
    repositoryUrl: "https://github.com/cauyxy/sotoapp",
    repositoryLabel: "github.com/cauyxy/sotoapp"
  };
}
