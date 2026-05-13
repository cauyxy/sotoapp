import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/svelte";
import type { LatestState } from "../lib/useLatest.svelte";

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.doUnmock("../lib/useLatest.svelte");
});

async function renderWithState(state: LatestState) {
  vi.doMock("../lib/useLatest.svelte", () => ({
    useLatest: () => ({ value: state })
  }));
  // Dynamic import so the mock is in place before Download.svelte loads.
  // Also dynamically import render so it shares the same svelte instance
  // as the re-imported component (vi.resetModules() resets svelte internals).
  const [mod, { render }] = await Promise.all([
    import("./Download.svelte"),
    import("@testing-library/svelte")
  ]);
  return render(mod.default);
}

describe("Download section", () => {
  it("renders loading copy when store is loading", async () => {
    await renderWithState({ status: "loading" });
    expect(screen.getByText(/Latest build · …/i)).toBeTruthy();
    expect(screen.getAllByText(/Loading…/i).length).toBeGreaterThanOrEqual(1);
  });

  it("renders the dmg and exe URLs when store is ok", async () => {
    await renderWithState({
      status: "ok",
      version: "0.3.1",
      pubDate: "2026-05-12T00:00:00.000Z",
      platforms: {
        "darwin-aarch64": {
          fileName: "Soto_0.3.1_darwin_aarch64.dmg",
          url: "https://example.test/Soto_0.3.1_darwin_aarch64.dmg"
        },
        "windows-x86_64": {
          fileName: "Soto_0.3.1_windows_x86_64-setup.exe",
          url: "https://example.test/Soto_0.3.1_windows_x86_64-setup.exe"
        }
      }
    });

    expect(screen.getByText(/v0\.3\.1/)).toBeTruthy();
    expect(screen.getByText("Soto_0.3.1_darwin_aarch64.dmg")).toBeTruthy();

    const macLink = screen.getByRole("link", { name: /Download \.dmg/i }) as HTMLAnchorElement;
    expect(macLink.href).toBe("https://example.test/Soto_0.3.1_darwin_aarch64.dmg");

    const winLink = screen.getByRole("link", { name: /Download \.exe/i }) as HTMLAnchorElement;
    expect(winLink.href).toBe("https://example.test/Soto_0.3.1_windows_x86_64-setup.exe");
  });

  it("renders the GitHub Releases fallback in error state", async () => {
    await renderWithState({ status: "error" });
    expect(screen.getByText(/Couldn't reach updater/i)).toBeTruthy();
    const fallbacks = screen.getAllByRole("link", { name: /Visit GitHub Releases/i });
    expect(fallbacks.length).toBeGreaterThanOrEqual(1);
    expect((fallbacks[0] as HTMLAnchorElement).href).toMatch(/github\.com.*releases/);
  });
});
