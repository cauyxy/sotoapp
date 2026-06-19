// Owns the global-hotkey runtime for the main process: builds the
// HotkeyRuntime from the saved mode bindings, installs the native keyboard
// hook, and — crucially — re-binds the chords whenever a mode is saved so a
// hotkey edit takes effect immediately instead of after a restart.
//
// Electron-free and koffi-free (the native hook arrives as an injected port),
// so the install/rebind logic is unit-testable with fakes.

import {
  HotkeyRuntime,
  hotkeyRuntimeActionFor,
  macKeyToModifier,
  parseChord,
  windowsVkToModifier,
  type HotkeyBindingReg,
  type HotkeyCaptureBeginResult,
  type HotkeyCaptureKey,
  type HotkeyKeyEvent,
  type HotkeyPlatform,
  type HotkeyRuntimeAction,
  type Mode,
} from "@soto/core";
import type { NativeFacilities } from "@soto/native-bridge";

export const HOTKEY_CAPTURE_TIMEOUT_MS = 60_000;

type NativeHookCallback = Parameters<NativeFacilities["hotkey"]["install"]>[0];
type NormalizedHookEvent = Parameters<NativeHookCallback>[0];

const MAC_ESCAPE = 0x35;
const MAC_RETURN = 0x24;
const MAC_KEYPAD_ENTER = 0x4c;
const WIN_ESCAPE = 0x1b;
const WIN_RETURN = 0x0d;

type HotkeyLogLevel = "info" | "warn" | "error";
type HotkeyLog = (level: HotkeyLogLevel, message: string) => void;

function hostCapturePlatform(): "windows" | "mac" {
  return process.platform === "win32" ? "windows" : "mac";
}

function capturePlatformFor(platform: HotkeyPlatform | undefined): "windows" | "mac" {
  return platform === "windows" || platform === "mac"
    ? platform
    : hostCapturePlatform();
}

export function classifyCaptureEdge(
  ev: NormalizedHookEvent,
  platform: "windows" | "mac",
): HotkeyCaptureKey | null {
  const modifier =
    platform === "windows"
      ? windowsVkToModifier(ev.key, { flags: ev.flags, scanCode: ev.scanCode })
      : macKeyToModifier(ev.key);
  if (modifier !== null) {
    return { kind: "modifier", modifier, down: ev.down };
  }
  if (!ev.down) return null;

  if (
    (platform === "windows" && ev.key === WIN_ESCAPE) ||
    (platform === "mac" && ev.key === MAC_ESCAPE)
  ) {
    return { kind: "escape" };
  }
  if (
    (platform === "windows" && ev.key === WIN_RETURN) ||
    (platform === "mac" && (ev.key === MAC_RETURN || ev.key === MAC_KEYPAD_ENTER))
  ) {
    return { kind: "confirm" };
  }
  return { kind: "other" };
}

/**
 * Build the HotkeyRuntime binding registry from the saved modes: one entry per
 * mode that has a hotkey, mapping its (canonical) chord string to the mode id.
 * Modes without a hotkey are skipped. A chord that fails to parse is dropped
 * (logged) rather than failing the whole registry — setBindings re-parses the
 * strings, so we pre-validate here to filter out the invalid ones first.
 */
export function bindingsFromModes(
  modes: readonly Mode[],
  log?: HotkeyLog,
): HotkeyBindingReg[] {
  const bindings: HotkeyBindingReg[] = [];
  for (const mode of modes) {
    if (mode.hotkey === null) continue;
    try {
      parseChord(mode.hotkey.chord); // validate; the registry holds the string
      bindings.push({ chord: mode.hotkey.chord, modeId: mode.id });
    } catch (error) {
      hotkeyWarn(
        log,
        `[main] skipping invalid chord for mode ${mode.id}: ${(error as Error).message}`,
      );
    }
  }
  return bindings;
}

export interface HotkeyServicePorts {
  /** Fresh mode list (the binding source of truth). */
  listModes: () => readonly Mode[];
  /** The native keyboard hook (NativeFacilities["hotkey"]). */
  hotkey: NativeFacilities["hotkey"];
  /** Sink for matched chord actions (SessionController.dispatch). */
  dispatch: (action: HotkeyRuntimeAction) => void;
  /**
   * Keycode→Modifier mapper selection for the HotkeyRuntime. Defaults to the
   * host platform; tests inject a fixed platform so their keycode fixtures
   * behave identically on every host.
   */
  platform?: HotkeyPlatform;
  log?: HotkeyLog;
}

/**
 * Global keyboard hook + HotkeyRuntime lifecycle. Native key edges arrive
 * through the injected hotkey port; queue-drain native ports deliver them from
 * Electron's main loop, while legacy direct-callback ports may still use the
 * callback return value for suppression.
 */
export class HotkeyService {
  private runtime: HotkeyRuntime | null = null;
  private capturing = false;
  private captureSession = 0;
  private captureSink: ((key: HotkeyCaptureKey) => void) | null = null;
  private captureWatchdog: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly ports: HotkeyServicePorts) {}

  /**
   * Build the runtime from the saved bindings and install the native hook.
   * Returns false when the bindings are rejected (non-disjoint chords) or the
   * hook cannot be created — on macOS the latter means Accessibility is not
   * yet granted; the PermissionGate retries once trust flips.
   */
  install(): boolean {
    const runtime = new HotkeyRuntime(
      this.ports.platform ?? (process.platform === "win32" ? "windows" : "mac"),
    );
    if (!this.applyBindings(runtime)) return false;

    const installed = this.ports.hotkey.install((ev) => {
      // Queue-drain ports invoke this from Electron's main JS loop. Legacy
      // direct-callback ports may still cross from native threads, so never let
      // a throw escape the hotkey callback.
      try {
        if (this.capturing) {
          if (!ev.repeat) {
            const key = classifyCaptureEdge(
              ev,
              capturePlatformFor(this.ports.platform),
            );
            if (key !== null) this.captureSink?.(key);
          }
          this.armWatchdog(this.captureSession);
          return this.ports.hotkey.supportsSuppression;
        }

        // ev: NormalizedKeyEvent { flags, key, down, repeat }. Feed it through
        // the ChordMatcher+coordinator; each resulting action toggles a session.
        const edge: HotkeyKeyEvent = {
          key: ev.key,
          down: ev.down,
          repeat: ev.repeat,
          flags: ev.flags,
        };
        const actions = runtime.feed(edge);
        for (const action of actions) {
          const runtimeAction = hotkeyRuntimeActionFor(action);
          if (runtimeAction !== null) this.ports.dispatch(runtimeAction);
        }
      } catch (error) {
        hotkeyLog(
          this.ports.log,
          "error",
          `[main] hotkey callback error: ${(error as Error).message}`,
        );
      }
      // Never swallow the key globally (return false): a missed chord must
      // still reach the focused app. Swallowing is a later refinement.
      return false;
    });
    if (installed) this.runtime = runtime;
    return installed;
  }

  beginCapture(
    sink: (key: HotkeyCaptureKey) => void,
  ): HotkeyCaptureBeginResult {
    if (this.runtime === null) {
      return { active: false, suppressing: false, sessionId: 0 };
    }
    const sessionId = ++this.captureSession;
    this.capturing = true;
    this.captureSink = sink;
    this.runtime.clearHeld();
    this.runtime.resetSession();
    this.armWatchdog(sessionId);
    return {
      active: true,
      suppressing: this.ports.hotkey.supportsSuppression,
      sessionId,
    };
  }

  endCapture(sessionId: number): void {
    if (!this.capturing || sessionId !== this.captureSession) return;
    this.teardownCapture();
  }

  forceEndCapture(): void {
    if (!this.capturing) return;
    this.captureSession++;
    this.teardownCapture();
  }

  /**
   * Re-read the saved modes and replace the live bindings. Called after a mode
   * is saved so a hotkey change is effective immediately. No-op before the hook
   * is installed (the install path reads fresh bindings itself). Returns false
   * when the new bindings are rejected; the previous bindings stay active.
   */
  rebind(): boolean {
    if (this.runtime === null) return false;
    return this.applyBindings(this.runtime);
  }

  /**
   * Return the chord coordinator to idle without an action. Called when the
   * SessionController consumed a start gesture as a notice dismissal — the
   * coordinator toggled to active on the press and must be unwound so the
   * next press is a clean `start`. No-op before the hook is installed.
   */
  resetSession(): void {
    this.runtime?.resetSession();
  }

  private armWatchdog(sessionId: number): void {
    this.clearWatchdog();
    this.captureWatchdog = setTimeout(() => {
      if (!this.capturing || sessionId !== this.captureSession) return;
      const sink = this.captureSink;
      this.teardownCapture();
      sink?.({ kind: "ended", reason: "timeout" });
    }, HOTKEY_CAPTURE_TIMEOUT_MS);
    if (typeof this.captureWatchdog.unref === "function") {
      this.captureWatchdog.unref();
    }
  }

  private clearWatchdog(): void {
    if (this.captureWatchdog === null) return;
    clearTimeout(this.captureWatchdog);
    this.captureWatchdog = null;
  }

  private teardownCapture(): void {
    this.capturing = false;
    this.captureSink = null;
    this.clearWatchdog();
    this.runtime?.clearHeld();
    this.runtime?.resetSession();
  }

  private applyBindings(runtime: HotkeyRuntime): boolean {
    const bindings = bindingsFromModes(this.ports.listModes(), this.ports.log);
    try {
      runtime.setBindings(bindings);
    } catch (error) {
      // Non-disjoint chords (the validator throws) — keep the app running with
      // the previous bindings (or none at bootstrap) rather than crashing.
      hotkeyLog(
        this.ports.log,
        "error",
        `[main] hotkey bindings rejected: ${(error as Error).message}`,
      );
      return false;
    }

    // Make the active bindings discoverable in the console (answers "what key?").
    if (bindings.length === 0) {
      hotkeyWarn(
        this.ports.log,
        "[main] hotkey hook will install but NO mode has a hotkey bound — nothing " +
          "will trigger dictation. Set a hotkey on a mode (or wipe ~/.soto to re-seed).",
      );
    } else {
      const summary = bindings.map((b) => `${b.modeId} → ${b.chord}`).join(", ");
      hotkeyLog(this.ports.log, "info", `[main] hotkey bindings (${bindings.length}): ${summary}`);
    }
    return true;
  }
}

function hotkeyWarn(log: HotkeyLog | undefined, message: string): void {
  hotkeyLog(log, "warn", message);
}

function hotkeyLog(
  log: HotkeyLog | undefined,
  level: HotkeyLogLevel,
  message: string,
): void {
  if (log !== undefined) log(level, message);
  else console[level](message);
}
