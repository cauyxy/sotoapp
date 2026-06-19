// Pure-TS HotkeyRuntime — composes the ported ChordMatcher and
// HotkeySessionCoordinator and owns the chordIndex->modeId registry, replacing
// the Rust glue in soto-tauri/src/hotkeys.rs. Input is integer keycodes (from
// the native hook); output is HotkeySessionActions (start/complete/cancel).
//
// Pipeline mirror (Rust):
//   native key edge -> map keycode to Modifier -> ChordMatcher.feed
//     -> MatchEvent{chordIndex, phase} -> registry chordIndex->modeId
//     -> HotkeySessionCoordinator.handleEvent -> HotkeySessionAction

import type { Chord, Modifier } from "../../foundation/chord/chord.js";
import { validateDisjoint } from "../../foundation/chord/chord.js";
import {
  ChordMatcher,
  type MatchEvent,
  type RawKeyEvent,
} from "../../foundation/chord/matcher.js";
import {
  HotkeySessionCoordinator,
  type HotkeySessionAction,
} from "./hotkeyCoordinator.js";
import type { HotkeyRuntimeAction } from "../../contract/events.js";
import {
  macKeyToModifier,
  windowsVkToModifier,
  type WindowsVkContext,
} from "./keycodes.js";

/** A keycode-only mapper: integer key -> canonical Modifier, or null. */
export type KeyMapper = (key: number) => Modifier | null;

/** Platform selection or an injected mapper. */
export type HotkeyPlatform = "windows" | "mac" | KeyMapper;

export interface HotkeyBindingReg {
  chord: Chord;
  modeId: string;
}

/** A native key edge, keyed by integer keycode. */
export interface HotkeyKeyEvent {
  key: number;
  down: boolean;
  repeat: boolean;
  /** Windows KBDLLHOOKSTRUCT.flags (extended-key bit); ignored on mac. */
  flags?: number;
  /** Windows KBDLLHOOKSTRUCT.scanCode (right-shift disambiguation). */
  scanCode?: number;
}

// Canonical Modifier -> a KeyboardEvent.code the ported ChordMatcher resolves
// back to the same Modifier (the matcher re-maps via modifierFromCode).
const MODIFIER_TO_CODE: Record<Modifier, { code: string; key?: string }> = {
  LeftCtrl: { code: "ControlLeft" },
  RightCtrl: { code: "ControlRight" },
  LeftAlt: { code: "AltLeft" },
  RightAlt: { code: "AltRight" },
  LeftShift: { code: "ShiftLeft" },
  RightShift: { code: "ShiftRight" },
  LeftMeta: { code: "MetaLeft" },
  RightMeta: { code: "MetaRight" },
  Fn: { code: "", key: "Fn" },
};

export class HotkeyRuntime {
  private readonly matcher = new ChordMatcher();
  private readonly coordinator = new HotkeySessionCoordinator();
  private readonly mapKey: (ev: HotkeyKeyEvent) => Modifier | null;
  // chordIndex -> modeId, indexed by binding array position.
  private modeIds: string[] = [];

  constructor(platform: HotkeyPlatform) {
    if (platform === "windows") {
      this.mapKey = (ev) => {
        const ctx: WindowsVkContext = {};
        if (ev.flags !== undefined) ctx.flags = ev.flags;
        if (ev.scanCode !== undefined) ctx.scanCode = ev.scanCode;
        return windowsVkToModifier(ev.key, ctx);
      };
    } else {
      const mapper: KeyMapper = platform === "mac" ? macKeyToModifier : platform;
      this.mapKey = (ev) => mapper(ev.key);
    }
  }

  /** The mode id of the running session, if any. */
  activeModeId(): string | null {
    return this.coordinator.activeModeId();
  }

  /**
   * Replace the registered bindings. Validates that the chords are pairwise
   * disjoint (no shared modifier), then rebuilds the matcher and the
   * chordIndex->modeId registry. Released chords from the matcher rebuild are
   * fed through the coordinator for fidelity (releases are ignored).
   */
  setBindings(bindings: readonly HotkeyBindingReg[]): void {
    const conflict = validateDisjoint(bindings.map((b) => b.chord));
    if (conflict !== null) {
      throw new Error(
        `hotkey bindings are not disjoint: chords ${conflict.firstIndex} and ` +
          `${conflict.secondIndex} share ${conflict.sharedModifiers.join("+")}`,
      );
    }
    this.modeIds = bindings.map((b) => b.modeId);
    const released = this.matcher.replaceChords(bindings.map((b) => b.chord));
    this.driveCoordinator(released);
  }

  /**
   * Feed a native key edge. Maps the keycode to a Modifier (non-modifier ->
   * no-op), feeds the matcher, resolves chordIndex->modeId, drives the
   * coordinator, and returns the resulting non-ignored actions.
   */
  feed(ev: HotkeyKeyEvent): HotkeySessionAction[] {
    if (ev.repeat) return [];
    const modifier = this.mapKey(ev);
    if (modifier === null) return [];

    const target = MODIFIER_TO_CODE[modifier];
    const raw: RawKeyEvent = { code: target.code, down: ev.down };
    if (target.key !== undefined) raw.key = target.key;
    const outcome = this.matcher.feed(raw);
    return this.driveCoordinator(outcome.events);
  }

  /** Cancel the running session (e.g. Escape). */
  cancelActive(): HotkeySessionAction | null {
    const action = this.coordinator.cancelActive();
    return action.type === "ignore" ? null : action;
  }

  /**
   * Return the coordinator to idle without an action — the downstream worker
   * consumed a start gesture without starting a session (chord-dismissed a
   * lingering notice). Keeps the coordinator and the worker in sync so the
   * next press is a clean `start`.
   */
  resetSession(): void {
    this.coordinator.reset();
  }

  /** Release all held modifiers (e.g. focus loss); returns resulting actions. */
  clearHeld(): HotkeySessionAction[] {
    return this.driveCoordinator(this.matcher.clearHeld());
  }

  private driveCoordinator(events: readonly MatchEvent[]): HotkeySessionAction[] {
    const actions: HotkeySessionAction[] = [];
    for (const event of events) {
      const modeId = this.modeIds[event.chordIndex];
      // Guard: registry changed mid-flight (mirrors Rust event_for_chord_index
      // returning None).
      if (modeId === undefined) continue;
      const action = this.coordinator.handleEvent({
        phase: event.type,
        modeId,
      });
      if (action.type !== "ignore") actions.push(action);
    }
    return actions;
  }
}

/**
 * Map a coordinator session action to the wire `soto://hotkey-runtime-action`
 * payload (snake_case mode_id), or null for `ignore`. Port of Rust
 * hotkey_runtime_action_for_event — the bridge between HotkeyRuntime.feed()
 * output and the emitted event. Lives in the domain layer (not contract): it
 * maps a *session* action onto the *wire* shape, so it depends on both the
 * coordinator's HotkeySessionAction (domain) and the wire HotkeyRuntimeAction
 * (contract).
 */
export function hotkeyRuntimeActionFor(
  action: HotkeySessionAction,
): HotkeyRuntimeAction | null {
  switch (action.type) {
    case "start":
      return { kind: "start_recording", mode_id: action.modeId };
    case "complete":
      return { kind: "finish_recording", mode_id: action.modeId };
    case "cancel":
      return { kind: "cancel_recording", mode_id: action.modeId };
    case "ignore":
      return null;
  }
}
