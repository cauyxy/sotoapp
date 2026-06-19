import {
  modifierFromCode,
  type Chord,
  type Modifier,
} from "./chord.js";

export interface RawKeyEvent {
  code: string;
  key?: string;
  down: boolean;
}

export type MatchEvent =
  | { type: "pressed"; chordIndex: number }
  | { type: "released"; chordIndex: number };

export interface MatchOutcome {
  events: MatchEvent[];
  swallow: "pass_through" | "swallow";
}

/**
 * Stateful chord matcher. Pure-TS port of soto_hotkey::Matcher: tracks held
 * modifiers, re-evaluates registered chords on each key edge, and emits
 * pressed/released as chords transition in and out of "all members held".
 */
export class ChordMatcher {
  private chords: Modifier[][] = [];
  private readonly held = new Set<Modifier>();
  private readonly active = new Set<number>();

  /**
   * Replace the active chord set. Emits released for any currently-active
   * chords and clears held modifiers — releasing held state prevents a newly
   * registered combo from being seen as "all members held" because of stale
   * modifier state (a key held before registration must be released and
   * repressed to count). Port of soto_hotkey::Matcher::replace_chords.
   */
  replaceChords(chords: readonly Chord[]): MatchEvent[] {
    const released = this.releaseActive();
    this.held.clear();
    this.chords = chords.map((c) => c.split("+") as Modifier[]);
    return released;
  }

  /** Drop held modifiers and release active chords (e.g. on focus loss). */
  clearHeld(): MatchEvent[] {
    const released = this.releaseActive();
    this.held.clear();
    return released;
  }

  private releaseActive(): MatchEvent[] {
    const released: MatchEvent[] = [...this.active].map((chordIndex) => ({
      type: "released",
      chordIndex,
    }));
    this.active.clear();
    return released;
  }

  feed(event: RawKeyEvent): MatchOutcome {
    const modifier = modifierFromCode(event.code, event.key);
    if (modifier !== null) {
      if (event.down) this.held.add(modifier);
      else this.held.delete(modifier);
    }

    const events: MatchEvent[] = [];
    this.chords.forEach((members, index) => {
      const matchedNow = members.every((m) => this.held.has(m));
      const wasActive = this.active.has(index);
      if (matchedNow && !wasActive) {
        this.active.add(index);
        events.push({ type: "pressed", chordIndex: index });
      } else if (!matchedNow && wasActive) {
        this.active.delete(index);
        events.push({ type: "released", chordIndex: index });
      }
    });

    return { events, swallow: "pass_through" };
  }
}
