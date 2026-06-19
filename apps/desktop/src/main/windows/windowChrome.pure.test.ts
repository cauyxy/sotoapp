import { describe, expect, it } from "vitest";

import { isWindowThemeSource, overlaySymbolColor, themeSourceFor } from "./windowChrome.pure.js";

describe("overlaySymbolColor", () => {
  it("uses cream glyphs on dark Windows titlebar overlays", () => {
    expect(overlaySymbolColor(true)).toBe("#ECEAE3");
  });

  it("uses ink glyphs on light Windows titlebar overlays", () => {
    expect(overlaySymbolColor(false)).toBe("#1A1D22");
  });
});

describe("themeSourceFor", () => {
  it("passes supported app theme settings through to Electron", () => {
    expect(themeSourceFor("system")).toBe("system");
    expect(themeSourceFor("light")).toBe("light");
    expect(themeSourceFor("dark")).toBe("dark");
  });

  it("falls back to system for invalid persisted settings", () => {
    expect(themeSourceFor("sepia")).toBe("system");
    expect(themeSourceFor(null)).toBe("system");
  });
});

describe("isWindowThemeSource", () => {
  it("accepts only Electron-supported theme sources", () => {
    expect(isWindowThemeSource("system")).toBe(true);
    expect(isWindowThemeSource("light")).toBe(true);
    expect(isWindowThemeSource("dark")).toBe(true);
    expect(isWindowThemeSource("sepia")).toBe(false);
    expect(isWindowThemeSource(null)).toBe(false);
  });
});
