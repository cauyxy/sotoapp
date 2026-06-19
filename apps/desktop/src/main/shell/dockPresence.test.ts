import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => {
  const trayInstances: Array<{
    setToolTip: ReturnType<typeof vi.fn>;
    setContextMenu: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }> = [];

  return {
    app: {
      setActivationPolicy: vi.fn(),
    },
    menu: {
      buildFromTemplate: vi.fn((template: unknown) => ({ template })),
    },
    nativeImage: {
      createFromPath: vi.fn(() => ({
        isEmpty: () => false,
        setTemplateImage: vi.fn(),
      })),
    },
    trayInstances,
    Tray: vi.fn(function MockTray(this: (typeof trayInstances)[number]) {
      this.setToolTip = vi.fn();
      this.setContextMenu = vi.fn();
      this.on = vi.fn();
      this.destroy = vi.fn();
      trayInstances.push(this);
    }),
  };
});

vi.mock("electron", () => ({
  app: electronMocks.app,
  Menu: electronMocks.menu,
  nativeImage: electronMocks.nativeImage,
  Tray: electronMocks.Tray,
}));

import { DockPresenceController } from "./dockPresence.js";

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
}

describe("DockPresenceController", () => {
  const realPlatform = process.platform;
  let windowSkipTaskbar: ReturnType<typeof vi.fn>;
  let openMainWindow: ReturnType<typeof vi.fn>;
  let quit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    electronMocks.trayInstances.length = 0;
    windowSkipTaskbar = vi.fn();
    openMainWindow = vi.fn();
    quit = vi.fn();
  });

  afterEach(() => {
    setPlatform(realPlatform);
  });

  function makeController(overrides: { trayIconPath?: string; trayIsTemplate?: boolean } = {}) {
    return new DockPresenceController({
      getMainWindow: () =>
        ({
          isDestroyed: () => false,
          setSkipTaskbar: windowSkipTaskbar,
        }) as never,
      openMainWindow,
      quit,
      trayIconPath: overrides.trayIconPath ?? "icon.png",
      trayIsTemplate: overrides.trayIsTemplate ?? false,
      labels: { open: "Open Soto", quit: "Quit Soto", tooltip: "Soto" },
    });
  }

  it("applies macOS accessory mode and a status-bar item when the setting hides the icon", () => {
    setPlatform("darwin");
    const controller = makeController();

    controller.setHideIcon(true);
    controller.setHideIcon(true);

    expect(electronMocks.app.setActivationPolicy).toHaveBeenCalledTimes(1);
    expect(electronMocks.app.setActivationPolicy).toHaveBeenCalledWith("accessory");
    expect(windowSkipTaskbar).toHaveBeenLastCalledWith(false);
    expect(electronMocks.Tray).toHaveBeenCalledTimes(1);
    expect(electronMocks.trayInstances[0]?.setToolTip).toHaveBeenCalledWith("Soto");
  });

  it("marks the macOS status-bar image as a template so the menu bar auto-inverts", () => {
    setPlatform("darwin");
    const controller = makeController({ trayIconPath: "iconTemplate.png", trayIsTemplate: true });

    controller.setHideIcon(true);

    const created = electronMocks.nativeImage.createFromPath.mock.results[0]?.value as {
      setTemplateImage: ReturnType<typeof vi.fn>;
    };
    expect(created.setTemplateImage).toHaveBeenCalledWith(true);
  });

  it("keeps macOS accessory mode after a full-screen capsule ends while the setting is on", () => {
    setPlatform("darwin");
    const controller = makeController();

    controller.setHideIcon(true);
    controller.setCapsuleAccessoryNeeded(true);
    controller.setCapsuleAccessoryNeeded(false);

    expect(electronMocks.app.setActivationPolicy).toHaveBeenCalledTimes(1);
    expect(electronMocks.app.setActivationPolicy).toHaveBeenCalledWith("accessory");
  });

  it("does not show a macOS status-bar item for transient capsule accessory mode", () => {
    setPlatform("darwin");
    const controller = makeController();

    controller.setCapsuleAccessoryNeeded(true);

    expect(electronMocks.app.setActivationPolicy).toHaveBeenCalledWith("accessory");
    expect(electronMocks.Tray).not.toHaveBeenCalled();
  });

  it("restores macOS regular mode and destroys the status-bar item when the setting is turned off", () => {
    setPlatform("darwin");
    const controller = makeController();

    controller.setHideIcon(true);
    controller.setHideIcon(false);

    expect(electronMocks.app.setActivationPolicy).toHaveBeenLastCalledWith("regular");
    expect(electronMocks.trayInstances[0]?.destroy).toHaveBeenCalledTimes(1);
  });

  it("applies Windows skipTaskbar while keeping the tray available", () => {
    setPlatform("win32");
    const controller = makeController();

    controller.setHideIcon(false);
    controller.setHideIcon(true);

    expect(electronMocks.app.setActivationPolicy).not.toHaveBeenCalled();
    expect(windowSkipTaskbar).toHaveBeenLastCalledWith(true);
    expect(electronMocks.Tray).toHaveBeenCalledTimes(1);
  });
});
