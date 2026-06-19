import { MODIFIER_CANONICAL_ORDER, type Modifier } from "@soto/core";

export type Os = "mac" | "win";

export interface KeyToken {
  label: string;
  side: "L" | "R" | null;
}

interface ModifierDisplay {
  keyLabel: { mac: string; win: string };
  side: "L" | "R" | null;
  /** OS-neutral pretty name (default when no os is supplied). */
  pretty: string;
  /** Overrides applied only when an os is supplied. */
  prettyMac?: string;
  prettyWin?: string;
}

const MODIFIER_DISPLAY: Record<Modifier, ModifierDisplay> = {
  LeftCtrl: { keyLabel: { mac: "⌃", win: "Ctrl" }, side: "L", pretty: "Left Ctrl" },
  RightCtrl: { keyLabel: { mac: "⌃", win: "Ctrl" }, side: "R", pretty: "Right Ctrl" },
  LeftAlt: { keyLabel: { mac: "⌥", win: "Alt" }, side: "L", pretty: "Left Alt", prettyMac: "Left Option" },
  RightAlt: { keyLabel: { mac: "⌥", win: "Alt" }, side: "R", pretty: "Right Alt", prettyMac: "Right Option" },
  LeftShift: { keyLabel: { mac: "⇧", win: "Shift" }, side: "L", pretty: "Left Shift" },
  RightShift: { keyLabel: { mac: "⇧", win: "Shift" }, side: "R", pretty: "Right Shift" },
  LeftMeta: { keyLabel: { mac: "⌘", win: "Win" }, side: "L", pretty: "Left Meta", prettyMac: "Left Command", prettyWin: "Left Win" },
  RightMeta: { keyLabel: { mac: "⌘", win: "Win" }, side: "R", pretty: "Right Meta", prettyMac: "Right Command", prettyWin: "Right Win" },
  Fn: { keyLabel: { mac: "Fn", win: "Fn" }, side: null, pretty: "Fn" },
};

export function isModifierSegment(segment: string): segment is Modifier {
  return Object.prototype.hasOwnProperty.call(MODIFIER_DISPLAY, segment);
}

export function keyTokenForSegment(segment: string, os: Os = "mac"): KeyToken {
  if (!isModifierSegment(segment)) return { label: segment, side: null };
  const display = MODIFIER_DISPLAY[segment];
  return { label: display.keyLabel[os], side: display.side };
}

export function prettyModifier(modifier: Modifier, os?: Os): string {
  const display = MODIFIER_DISPLAY[modifier];
  if (os === "mac") return display.prettyMac ?? display.pretty;
  if (os === "win") return display.prettyWin ?? display.pretty;
  return display.pretty;
}

export function prettyChord(chord: string, os?: Os): string {
  if (chord === "") return "";
  const segments = new Set(chord.split("+"));
  const ordered = MODIFIER_CANONICAL_ORDER.filter((modifier) => segments.has(modifier));
  const known = new Set<string>(ordered);
  const unknown = chord.split("+").filter((segment) => !known.has(segment));
  return [...ordered.map((modifier) => prettyModifier(modifier, os)), ...unknown].join(" + ");
}
