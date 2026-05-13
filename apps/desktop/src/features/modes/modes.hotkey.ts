import type { ModeEditorDraft } from "./modes.draft";

export const FN_KEY_ID = "Fn" as const;

export interface HotkeyModifierReleaseCaptureInput {
  code: string;
  key: string;
}

const MODIFIER_CODE_MAP: Record<string, string> = {
  ControlLeft: "LeftCtrl",
  ControlRight: "RightCtrl",
  AltLeft: "LeftAlt",
  AltRight: "RightAlt",
  ShiftLeft: "LeftShift",
  ShiftRight: "RightShift",
  MetaLeft: "LeftMeta",
  MetaRight: "RightMeta",
  OSLeft: "LeftMeta",
  OSRight: "RightMeta"
};

// Identifies which modifier key code is being pressed/released. Returns the
// stable id the capture state machine should track (KeyboardEvent.code, or the
// synthetic "Fn" for macOS Fn). Returns null for non-modifier keys.
export function modifierKeyId(code: string, key: string): string | null {
  if (MODIFIER_CODE_MAP[code]) return code;
  if (code === "" && key === "Fn") return FN_KEY_ID;
  return null;
}

export function hotkeyCaptureFromModifierRelease(
  input: HotkeyModifierReleaseCaptureInput
): Partial<ModeEditorDraft> | null {
  const chord = chordFromModifierRelease(input);
  console.debug("[soto-fe] hotkey capture (single modifier):", {
    code: input.code,
    key: input.key,
    chord
  });
  if (chord === null) return null;
  return { hotkey_enabled: true, hotkey_chord: chord };
}

function chordFromModifierRelease(
  input: HotkeyModifierReleaseCaptureInput
): string | null {
  if (input.code === "" && input.key === "Fn") return "Fn";
  return MODIFIER_CODE_MAP[input.code] ?? null;
}

export function prettyChord(chord: string): string {
  switch (chord) {
    case "":
      return "";
    case "LeftCtrl":
      return "Left Ctrl";
    case "RightCtrl":
      return "Right Ctrl";
    case "LeftAlt":
      return "Left Alt";
    case "RightAlt":
      return "Right Alt";
    case "LeftShift":
      return "Left Shift";
    case "RightShift":
      return "Right Shift";
    case "LeftMeta":
      return "Left Meta";
    case "RightMeta":
      return "Right Meta";
    case "Fn":
      return "Fn";
    default:
      return chord;
  }
}
