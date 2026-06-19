// PermissionGate — makes the global-hotkey hook self-arming behind the macOS
// Accessibility permission, so the user never has to hand-edit System Settings
// and never has to relaunch after granting.
//
// Why this exists: the hook is an ACTIVE CGEventTap (.defaultTap), which macOS
// gates on Accessibility (kTCCServiceAccessibility) — NOT Input Monitoring (that
// is only for listen-only taps). A fresh process is untrusted, so soto_hook_install
// returns null and `install: failed`. The fix is the same flow the old previous desktop shell app
// used: detect untrusted → fire AXIsProcessTrustedWithOptions(prompt:true) (adds
// the app to the Accessibility list + shows the system dialog) → poll trust and
// (re)install the hook the instant it flips to granted, emitting permission://updated.
//
// All IO is injected so the decision logic is unit-testable without timers or a
// live dylib. index.ts wires the ports to the native facilities + a 2 s timer.

import type { PermissionUpdatedEvent } from "@soto/core";

export interface PermissionGatePorts {
  /** AX trust WITHOUT prompting (AXIsProcessTrusted) — cheap, call every tick. */
  isAccessibilityTrusted(): boolean;
  /** Fire the macOS Accessibility prompt + add the app to the list (prompt:true). */
  promptAccessibility(): void;
  /** Microphone authorization (for reporting only; getUserMedia drives the real grant). */
  isMicrophoneGranted(): boolean;
  /** Attempt to install the global hotkey hook; returns true iff the tap was created. */
  installHotkeys(): boolean;
  /** Push a permission://updated snapshot to the renderer(s). */
  emitPermission(event: PermissionUpdatedEvent): void;
  /** Log a human-facing line (console in prod; captured in tests). */
  log(message: string): void;
}

export interface GateStep {
  /** Hotkey hook installed as of this step. */
  installed: boolean;
  /** Whether the caller should keep polling (false once installed, or no native). */
  polling: boolean;
}

export class PermissionGate {
  private installed = false;
  /** True once we've fired the system prompt, so we don't spam it each tick. */
  private prompted = false;

  constructor(private readonly ports: PermissionGatePorts) {}

  get isInstalled(): boolean {
    return this.installed;
  }

  /**
   * Run at bootstrap. If already trusted, installs immediately and we're done.
   * Otherwise fires the Accessibility prompt once and asks the caller to poll.
   */
  start(): GateStep {
    if (this.tryInstallIfTrusted()) return { installed: true, polling: false };

    this.prompted = true;
    this.ports.promptAccessibility();
    this.ports.log(
      "[main] Accessibility not granted — prompted; grant it in System Settings " +
        "and the global hotkey will arm automatically (no restart needed).",
    );
    this.emit(false);
    return { installed: false, polling: true };
  }

  /**
   * Call on each poll tick (~2 s). Re-checks trust and installs the hook the
   * moment it is granted. Returns polling:false once installed so the caller
   * can clear its timer.
   */
  tick(): GateStep {
    if (this.installed) return { installed: true, polling: false };
    if (this.tryInstallIfTrusted()) {
      this.ports.log("[main] Accessibility granted — global hotkey hook installed.");
      return { installed: true, polling: false };
    }
    return { installed: false, polling: true };
  }

  /** Installs the hook iff currently trusted; emits the new snapshot on success. */
  private tryInstallIfTrusted(): boolean {
    if (!this.ports.isAccessibilityTrusted()) return false;
    const ok = this.ports.installHotkeys();
    if (ok) {
      this.installed = true;
      this.emit(true);
    }
    return ok;
  }

  private emit(hotkeyInstalled: boolean): void {
    this.ports.emitPermission({
      accessibility: this.ports.isAccessibilityTrusted(),
      microphone: this.ports.isMicrophoneGranted(),
      hotkey_installed: hotkeyInstalled,
    });
  }
}
