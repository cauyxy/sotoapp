import { describe, expect, it } from "vitest";
import { resolveTrayAsset } from "./trayAsset.pure.js";

describe("resolveTrayAsset", () => {
  it("uses a template image on macOS so the menu bar auto-inverts", () => {
    expect(resolveTrayAsset("darwin")).toEqual({
      file: "tray/iconTemplate.png",
      isTemplate: true,
    });
  });

  it("uses a multi-size ICO on Windows", () => {
    expect(resolveTrayAsset("win32")).toEqual({ file: "tray/icon.ico", isTemplate: false });
  });

  it("falls back to a PNG on other platforms", () => {
    expect(resolveTrayAsset("linux")).toEqual({ file: "tray/icon.png", isTemplate: false });
  });
});
