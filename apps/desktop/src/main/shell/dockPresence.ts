import {
  app,
  Menu,
  nativeImage,
  Tray,
  type BrowserWindow,
  type MenuItemConstructorOptions,
} from "electron";
import { resolveDockPresence, type ActivationPolicy } from "./dockPresence.pure.js";

export interface DockPresenceDeps {
  getMainWindow: () => BrowserWindow | null;
  openMainWindow: () => void;
  quit: () => void;
  trayIconPath: string;
  trayIsTemplate: boolean;
  labels: { open: string; quit: string; tooltip: string };
  log?: (message: string) => void;
}

export class DockPresenceController {
  private settingHidesIcon = false;
  private capsuleNeedsAccessory = false;
  private tray: Tray | null = null;
  private appliedPolicy: ActivationPolicy | null = null;

  constructor(private readonly deps: DockPresenceDeps) {}

  setHideIcon(on: boolean): void {
    this.settingHidesIcon = on;
    this.apply();
  }

  setCapsuleAccessoryNeeded(on: boolean): void {
    this.capsuleNeedsAccessory = on;
    this.apply();
  }

  refresh(): void {
    this.apply();
  }

  private apply(): void {
    const target = resolveDockPresence({
      platform: process.platform,
      settingHidesIcon: this.settingHidesIcon,
      capsuleNeedsAccessory: this.capsuleNeedsAccessory,
    });

    if (target.activationPolicy !== null && target.activationPolicy !== this.appliedPolicy) {
      try {
        app.setActivationPolicy(target.activationPolicy);
        this.appliedPolicy = target.activationPolicy;
      } catch (error) {
        this.log(
          `[main] setActivationPolicy(${target.activationPolicy}) failed: ${
            (error as Error).message
          }`,
        );
      }
    }

    const win = this.deps.getMainWindow();
    if (win !== null && !win.isDestroyed()) {
      win.setSkipTaskbar(target.skipTaskbar);
    }

    this.ensureTray(target.trayVisible);
  }

  private ensureTray(visible: boolean): void {
    if (!visible) {
      if (this.tray !== null) {
        this.tray.destroy();
        this.tray = null;
      }
      return;
    }
    if (this.tray !== null) return;

    const icon = nativeImage.createFromPath(this.deps.trayIconPath);
    if (this.deps.trayIsTemplate) {
      icon.setTemplateImage(true);
    }
    // No manual resize: Electron picks the @2x/@3x sibling (macOS) or the right
    // embedded ICO size (Windows) per display scale. Resizing here is what made
    // the old single-PNG tray icon blurry.
    this.tray = new Tray(icon.isEmpty() ? this.deps.trayIconPath : icon);
    this.tray.setToolTip(this.deps.labels.tooltip);
    this.tray.setContextMenu(Menu.buildFromTemplate(this.menuTemplate()));
    this.tray.on("click", this.deps.openMainWindow);
    this.tray.on("double-click", this.deps.openMainWindow);
  }

  private menuTemplate(): MenuItemConstructorOptions[] {
    return [
      {
        label: this.deps.labels.open,
        click: this.deps.openMainWindow,
      },
      { type: "separator" },
      {
        label: this.deps.labels.quit,
        click: this.deps.quit,
      },
    ];
  }

  private log(message: string): void {
    if (this.deps.log !== undefined) this.deps.log(message);
    else console.warn(message);
  }
}
