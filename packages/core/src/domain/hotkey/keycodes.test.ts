import { describe, expect, it } from "vitest";
import { macKeyToModifier, windowsVkToModifier } from "./keycodes.js";

describe("windowsVkToModifier", () => {
  it("maps the dedicated left/right VKs unambiguously", () => {
    expect(windowsVkToModifier(0xa2)).toBe("LeftCtrl");
    expect(windowsVkToModifier(0xa3)).toBe("RightCtrl");
    expect(windowsVkToModifier(0xa4)).toBe("LeftAlt");
    expect(windowsVkToModifier(0xa5)).toBe("RightAlt");
    expect(windowsVkToModifier(0xa0)).toBe("LeftShift");
    expect(windowsVkToModifier(0xa1)).toBe("RightShift");
    expect(windowsVkToModifier(0x5b)).toBe("LeftMeta");
    expect(windowsVkToModifier(0x5c)).toBe("RightMeta");
  });

  it("disambiguates generic VK_CONTROL by the extended flag", () => {
    expect(windowsVkToModifier(0x11)).toBe("LeftCtrl"); // no flags
    expect(windowsVkToModifier(0x11, { flags: 0x01 })).toBe("RightCtrl");
    expect(windowsVkToModifier(0x11, { flags: 0x00 })).toBe("LeftCtrl");
  });

  it("disambiguates generic VK_MENU by the extended flag", () => {
    expect(windowsVkToModifier(0x12)).toBe("LeftAlt");
    expect(windowsVkToModifier(0x12, { flags: 0x01 })).toBe("RightAlt");
  });

  it("resolves generic VK_SHIFT by scan code (0x36 => right, else left)", () => {
    expect(windowsVkToModifier(0x10)).toBe("LeftShift");
    expect(windowsVkToModifier(0x10, { scanCode: 0x2a })).toBe("LeftShift");
    expect(windowsVkToModifier(0x10, { scanCode: 0x36 })).toBe("RightShift");
  });

  it("returns null for non-modifier keys (no Fn on Windows)", () => {
    expect(windowsVkToModifier(0x1e)).toBeNull(); // 'A' scan/vk-ish
    expect(windowsVkToModifier(0x41)).toBeNull(); // 'A'
    expect(windowsVkToModifier(0x7b)).toBeNull(); // F12
    expect(windowsVkToModifier(0x00)).toBeNull();
  });
});

describe("macKeyToModifier", () => {
  it("maps the modifier keycodes including Fn", () => {
    expect(macKeyToModifier(0x37)).toBe("LeftMeta");
    expect(macKeyToModifier(0x36)).toBe("RightMeta");
    expect(macKeyToModifier(0x38)).toBe("LeftShift");
    expect(macKeyToModifier(0x3c)).toBe("RightShift");
    expect(macKeyToModifier(0x3a)).toBe("LeftAlt");
    expect(macKeyToModifier(0x3d)).toBe("RightAlt");
    expect(macKeyToModifier(0x3b)).toBe("LeftCtrl");
    expect(macKeyToModifier(0x3e)).toBe("RightCtrl");
    expect(macKeyToModifier(0x3f)).toBe("Fn");
  });

  it("returns null for non-modifier keys", () => {
    expect(macKeyToModifier(0x00)).toBeNull(); // 'A'
    expect(macKeyToModifier(0x6f)).toBeNull(); // F12
    expect(macKeyToModifier(0xffff)).toBeNull();
  });
});
