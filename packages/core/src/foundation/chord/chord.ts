// Pure-TS port of soto_core::hotkey (Chord/Modifier). Canonical modifier
// order matches Rust soto_core::Modifiers::iter so a chord serialized here is
// byte-identical to one parsed on the (former) backend.

export type Modifier =
  | "LeftCtrl"
  | "RightCtrl"
  | "LeftAlt"
  | "RightAlt"
  | "LeftShift"
  | "RightShift"
  | "LeftMeta"
  | "RightMeta"
  | "Fn";

/** A chord is its canonical "Mod1+Mod2+..." string. */
export type Chord = string;

export const MODIFIER_CANONICAL_ORDER: readonly Modifier[] = [
  "LeftCtrl",
  "RightCtrl",
  "LeftAlt",
  "RightAlt",
  "LeftShift",
  "RightShift",
  "LeftMeta",
  "RightMeta",
  "Fn",
];

// KeyboardEvent.code (and macOS OS* aliases) -> canonical modifier.
const CODE_TO_MODIFIER: Record<string, Modifier> = {
  ControlLeft: "LeftCtrl",
  ControlRight: "RightCtrl",
  AltLeft: "LeftAlt",
  AltRight: "RightAlt",
  ShiftLeft: "LeftShift",
  ShiftRight: "RightShift",
  MetaLeft: "LeftMeta",
  MetaRight: "RightMeta",
  OSLeft: "LeftMeta",
  OSRight: "RightMeta",
};

const TOKEN_TO_MODIFIER: Record<string, Modifier> = Object.fromEntries(
  MODIFIER_CANONICAL_ORDER.map((m) => [m, m]),
);

/**
 * Map a raw key code (KeyboardEvent.code, or "" + key "Fn" for macOS Fn) to a
 * canonical modifier, or null for non-modifier keys.
 */
export function modifierFromCode(code: string, key?: string): Modifier | null {
  const mapped = CODE_TO_MODIFIER[code];
  if (mapped) return mapped;
  if (code === "" && key === "Fn") return "Fn";
  return null;
}

const CANONICAL_INDEX: Record<Modifier, number> = Object.fromEntries(
  MODIFIER_CANONICAL_ORDER.map((m, i) => [m, i]),
) as Record<Modifier, number>;

/**
 * Parse a "Mod1+Mod2+..." chord string into its modifiers in canonical order.
 * Port of soto_core::Chord::parse: rejects empty input/segments, unknown
 * components, and duplicates.
 */
export function parseChord(input: string): Modifier[] {
  if (input.length === 0) throw new Error("chord is empty");
  const seen = new Set<Modifier>();
  for (const segment of input.split("+")) {
    if (segment.length === 0) throw new Error("chord has an empty component");
    const modifier = TOKEN_TO_MODIFIER[segment];
    if (modifier === undefined) {
      throw new Error(`unknown chord component: ${segment}`);
    }
    if (seen.has(modifier)) {
      throw new Error(`duplicate chord component: ${segment}`);
    }
    seen.add(modifier);
  }
  return serializeChord([...seen]).split("+") as Modifier[];
}

/** Serialize a modifier set to a canonical-order "Mod1+Mod2+..." string. */
export function serializeChord(modifiers: readonly Modifier[]): Chord {
  return [...modifiers]
    .sort((a, b) => CANONICAL_INDEX[a] - CANONICAL_INDEX[b])
    .join("+");
}

export interface DisjointConflict {
  firstIndex: number;
  secondIndex: number;
  sharedModifiers: Modifier[];
}

/**
 * Validate that no two chords share a modifier. Returns the first overlapping
 * pair (with the shared modifiers in canonical order) or null if all disjoint.
 */
export function validateDisjoint(
  chords: readonly Chord[],
): DisjointConflict | null {
  const sets = chords.map((c) => new Set(parseChord(c)));
  for (let i = 0; i < sets.length; i++) {
    const a = sets[i]!;
    for (let j = i + 1; j < sets.length; j++) {
      const b = sets[j]!;
      const shared = [...a].filter((m) => b.has(m));
      if (shared.length > 0) {
        return {
          firstIndex: i,
          secondIndex: j,
          sharedModifiers: serializeChord(shared).split("+") as Modifier[],
        };
      }
    }
  }
  return null;
}
