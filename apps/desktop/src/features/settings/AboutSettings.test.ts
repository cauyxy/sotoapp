// @vitest-environment happy-dom
import { mount, tick, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import AboutSettings from "./AboutSettings.svelte";

const tauriMocks = vi.hoisted(() => ({
  getVersion: vi.fn<() => Promise<string>>(),
  openUrl: vi.fn<(url: string) => Promise<void>>(),
  check: vi.fn<() => Promise<unknown>>(),
  relaunch: vi.fn<() => Promise<void>>()
}));

vi.mock("@tauri-apps/api/app", () => ({ getVersion: tauriMocks.getVersion }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: tauriMocks.openUrl }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: tauriMocks.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: tauriMocks.relaunch }));

async function flushSvelte() {
  await Promise.resolve();
  await tick();
  await Promise.resolve();
  await tick();
}

function renderAboutSettings() {
  const target = document.createElement("div");
  document.body.appendChild(target);
  const component = mount(AboutSettings, { target });
  return { component, target };
}

describe("AboutSettings", () => {
  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("renders the app version without any dogfood suffix", async () => {
    tauriMocks.getVersion.mockResolvedValue("0.1.0");
    const { component, target } = renderAboutSettings();
    await flushSvelte();

    expect(target.textContent).toContain("Version 0.1.0");
    expect(target.textContent).not.toContain("internal dogfood");

    unmount(component);
  });

  it("shows 'up to date' message when no update is available", async () => {
    tauriMocks.getVersion.mockResolvedValue("0.1.0");
    tauriMocks.check.mockResolvedValue(null);
    const { component, target } = renderAboutSettings();
    await flushSvelte();

    const btn = Array.from(target.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Check for updates"
    );
    expect(btn).toBeDefined();
    btn?.click();
    await flushSvelte();

    expect(target.textContent).toContain("Soto is up to date.");
    expect(target.textContent).not.toContain("Check for updates");

    unmount(component);
  });

  it("shows install button and version when an update is available", async () => {
    tauriMocks.getVersion.mockResolvedValue("0.1.0");
    tauriMocks.check.mockResolvedValue({
      available: true,
      version: "1.2.0",
      downloadAndInstall: vi.fn().mockResolvedValue(undefined)
    });
    const { component, target } = renderAboutSettings();
    await flushSvelte();

    Array.from(target.querySelectorAll("button"))
      .find((b) => b.textContent?.trim() === "Check for updates")
      ?.click();
    await flushSvelte();

    expect(target.textContent).toContain("1.2.0");
    expect(
      Array.from(target.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === "Install & Restart"
      )
    ).toBeDefined();

    unmount(component);
  });

  it("shows failed message and retry button when check throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    tauriMocks.getVersion.mockResolvedValue("0.1.0");
    tauriMocks.check.mockRejectedValue(new Error("network error"));
    const { component, target } = renderAboutSettings();
    await flushSvelte();

    Array.from(target.querySelectorAll("button"))
      .find((b) => b.textContent?.trim() === "Check for updates")
      ?.click();
    await flushSvelte();

    expect(target.textContent).toContain("Could not check for updates.");
    expect(
      Array.from(target.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === "Retry"
      )
    ).toBeDefined();
    expect(errorSpy).toHaveBeenCalledWith(
      "settings/about: update check failed",
      expect.any(Error)
    );

    unmount(component);
  });

  it("opens the repository URL through the opener plugin", async () => {
    tauriMocks.getVersion.mockResolvedValue("0.1.0");
    tauriMocks.openUrl.mockResolvedValue();
    const { component, target } = renderAboutSettings();
    await flushSvelte();

    target
      .querySelector<HTMLAnchorElement>('a[href="https://github.com/cauyxy/sotoapp"]')
      ?.click();
    await Promise.resolve();

    expect(tauriMocks.openUrl).toHaveBeenCalledWith("https://github.com/cauyxy/sotoapp");

    unmount(component);
  });
});
