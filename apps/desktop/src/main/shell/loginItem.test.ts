import { describe, expect, it, vi } from "vitest";
import { syncLaunchAtLogin } from "./loginItem.js";

describe("syncLaunchAtLogin", () => {
  it.each([
    { platform: "darwin" as const, launchAtLogin: true },
    { platform: "win32" as const, launchAtLogin: true },
    { platform: "darwin" as const, launchAtLogin: false },
    { platform: "win32" as const, launchAtLogin: false },
  ])(
    "syncs packaged $platform login item to $launchAtLogin",
    ({ platform, launchAtLogin }) => {
      const setLoginItemSettings = vi.fn();

      syncLaunchAtLogin({
        isPackaged: true,
        platform,
        launchAtLogin,
        setLoginItemSettings,
      });

      expect(setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: launchAtLogin });
    },
  );

  it("does not write a login item for development builds", () => {
    const setLoginItemSettings = vi.fn();

    syncLaunchAtLogin({
      isPackaged: false,
      platform: "darwin",
      launchAtLogin: true,
      setLoginItemSettings,
    });

    expect(setLoginItemSettings).not.toHaveBeenCalled();
  });

  it("does not write a login item on unsupported platforms", () => {
    const setLoginItemSettings = vi.fn();

    syncLaunchAtLogin({
      isPackaged: true,
      platform: "linux",
      launchAtLogin: true,
      setLoginItemSettings,
    });

    expect(setLoginItemSettings).not.toHaveBeenCalled();
  });

  it("logs and continues when the OS rejects the login item update", () => {
    const log = vi.fn();

    expect(() =>
      syncLaunchAtLogin({
        isPackaged: true,
        platform: "win32",
        launchAtLogin: false,
        setLoginItemSettings: () => {
          throw new Error("registry denied");
        },
        log,
      }),
    ).not.toThrow();

    expect(log).toHaveBeenCalledWith(
      "[main] setLoginItemSettings(openAtLogin=false) failed: registry denied",
    );
  });
});
