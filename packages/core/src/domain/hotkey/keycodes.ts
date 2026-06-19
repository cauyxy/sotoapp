// Pure integer keycode -> Modifier lookup tables, ported 1:1 from the native
// hooks. Windows resolves three generic VKs (Ctrl/Menu/Shift) via the
// extended-key flag and shift scan code; macOS keycodes already encode L/R/Fn.
//
// Sources:
//   soto-platform-win/src/keyboard_hook.rs  (map_modifier + windows_key_code)
//   soto-platform-mac/src/hook.rs           (mac_key_code)

import type { Modifier } from "../../foundation/chord/chord.js";

// --- Windows -------------------------------------------------------------

// LLKHF_EXTENDED bit on KBDLLHOOKSTRUCT.flags.
const LLKHF_EXTENDED = 0x01;
// Right-shift scan code; left shift is 0x2a.
const SCAN_RIGHT_SHIFT = 0x36;

// Dedicated, unambiguous L/R virtual-key codes.
const WIN_VK_DEDICATED: Record<number, Modifier> = {
  0xa2: "LeftCtrl",
  0xa3: "RightCtrl",
  0xa4: "LeftAlt",
  0xa5: "RightAlt",
  0xa0: "LeftShift",
  0xa1: "RightShift",
  0x5b: "LeftMeta",
  0x5c: "RightMeta",
};

const WIN_VK_CONTROL = 0x11;
const WIN_VK_MENU = 0x12;
const WIN_VK_SHIFT = 0x10;

export interface WindowsVkContext {
  /** KBDLLHOOKSTRUCT.flags; LLKHF_EXTENDED (0x01) selects the right-hand key. */
  flags?: number;
  /** KBDLLHOOKSTRUCT.scanCode; 0x36 selects right shift for generic VK_SHIFT. */
  scanCode?: number;
}

/**
 * Map a Windows virtual-key code to a canonical Modifier, or null for
 * non-modifier keys. There is no Fn modifier on Windows.
 */
export function windowsVkToModifier(
  vk: number,
  ctx: WindowsVkContext = {},
): Modifier | null {
  const dedicated = WIN_VK_DEDICATED[vk];
  if (dedicated !== undefined) return dedicated;

  const extended = ((ctx.flags ?? 0) & LLKHF_EXTENDED) !== 0;
  switch (vk) {
    case WIN_VK_CONTROL:
      return extended ? "RightCtrl" : "LeftCtrl";
    case WIN_VK_MENU:
      return extended ? "RightAlt" : "LeftAlt";
    case WIN_VK_SHIFT:
      return ctx.scanCode === SCAN_RIGHT_SHIFT ? "RightShift" : "LeftShift";
    default:
      return null;
  }
}

// --- macOS ---------------------------------------------------------------

// CGEvent keyboard keycode -> Modifier. Non-modifier keys map to null.
const MAC_KEY_TO_MODIFIER: Record<number, Modifier> = {
  0x37: "LeftMeta",
  0x36: "RightMeta",
  0x38: "LeftShift",
  0x3c: "RightShift",
  0x3a: "LeftAlt",
  0x3d: "RightAlt",
  0x3b: "LeftCtrl",
  0x3e: "RightCtrl",
  0x3f: "Fn",
};

/**
 * Map a macOS CGEvent virtual keycode to a canonical Modifier, or null for
 * non-modifier keys.
 */
export function macKeyToModifier(key: number): Modifier | null {
  return MAC_KEY_TO_MODIFIER[key] ?? null;
}
