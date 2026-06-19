import {
  type Chord,
  MODIFIER_CANONICAL_ORDER,
  parseChord,
  serializeChord,
  type HotkeyCaptureKey,
  type Modifier,
} from "@soto/core";

export type { HotkeyCaptureKey };

export type CapturePhase = "listening" | "holding" | "captured";
export type CaptureHint = "onlyModifiers" | "maxTwo" | null;

export interface CaptureSnapshot {
  held: readonly Modifier[];
  candidate: readonly Modifier[] | null;
  chord: Chord | null;
  phase: CapturePhase;
  released: boolean;
  sawOther: boolean;
  maxHint: boolean;
  hint: CaptureHint;
  typingWarning: boolean;
}

export type CaptureAction =
  | { kind: "cancel" }
  | { kind: "commit"; chord: Chord }
  | { kind: "ended"; reason: "timeout" };

export interface CaptureMachine {
  getSnapshot(): CaptureSnapshot;
  feed(key: HotkeyCaptureKey): CaptureAction | null;
  reset(chord?: Chord): void;
}

const SAFE_LONE_MODIFIERS = new Set<Modifier>([
  "Fn",
  "RightCtrl",
  "RightMeta",
  "RightShift",
]);

function canonicalSort(modifiers: Iterable<Modifier>): Modifier[] {
  const set = new Set(modifiers);
  return MODIFIER_CANONICAL_ORDER.filter((modifier) => set.has(modifier));
}

function typingWarningFor(candidate: readonly Modifier[] | null): boolean {
  return (
    candidate !== null &&
    candidate.length === 1 &&
    !SAFE_LONE_MODIFIERS.has(candidate[0]!)
  );
}

export function createCaptureMachine(initialChord?: Chord): CaptureMachine {
  const held = new Set<Modifier>();
  let candidate: Modifier[] | null = null;
  let released = false;
  let sawOther = false;
  let maxHint = false;
  let hint: CaptureHint = null;

  function reset(chord?: Chord): void {
    held.clear();
    candidate = chord ? parseChord(chord) : null;
    released = candidate !== null;
    sawOther = false;
    maxHint = false;
    hint = null;
  }

  reset(initialChord);

  function getSnapshot(): CaptureSnapshot {
    const chord = candidate === null ? null : serializeChord(candidate);
    return {
      held: canonicalSort(held),
      candidate,
      chord,
      phase:
        candidate === null ? "listening" : released ? "captured" : "holding",
      released,
      sawOther,
      maxHint,
      hint,
      typingWarning: typingWarningFor(candidate),
    };
  }

  function feed(key: HotkeyCaptureKey): CaptureAction | null {
    if (key.kind === "escape") return { kind: "cancel" };
    if (key.kind === "ended") return { kind: "ended", reason: key.reason };
    if (key.kind === "confirm") {
      const snapshot = getSnapshot();
      return snapshot.phase === "captured" && snapshot.chord
        ? { kind: "commit", chord: snapshot.chord }
        : null;
    }
    if (key.kind === "other") {
      sawOther = true;
      hint = "onlyModifiers";
      return null;
    }

    if (key.down) {
      if (held.size >= 2 && !held.has(key.modifier)) {
        maxHint = true;
        hint = "maxTwo";
        return null;
      }
      if (held.size === 0) {
        candidate = [key.modifier];
      } else {
        candidate = canonicalSort([...held, key.modifier]);
      }
      held.add(key.modifier);
      released = false;
      return null;
    }

    held.delete(key.modifier);
    if (held.size === 0 && candidate !== null) {
      released = true;
    }
    return null;
  }

  return { getSnapshot, feed, reset };
}
