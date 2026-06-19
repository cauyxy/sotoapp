export type CapsuleBridge = Pick<
  SotoBridge,
  | "onVoiceRuntime"
  | "onCaptureControl"
  | "capture_started"
  | "push_capture_audio"
  | "push_capture_level"
  | "report_capture_error"
> & {
  /**
   * Toggle whether the (normally click-through) capsule overlay captures the
   * mouse, so the Panel's dismiss button is clickable on hover. Intersected here
   * rather than added to the global SotoBridge because it is capsule-only UI glue.
   * Optional + called via optional-chaining so a bridge without it (older preload
   * / a test fake) degrades to "no manual dismiss" instead of disabling the
   * whole capsule, and so the bridge presence check below need not require it.
   */
  setCapsuleInteractive?(interactive: boolean): void;
  /**
   * Window show/hide choreography pushes (will-show / will-hide with explicit
   * exit intent). Optional so a bridge without it (older preload / test fake)
   * degrades to no enter/exit animation instead of disabling the capsule.
   */
  onCapsuleOverlay?(cb: (payload: unknown) => void): () => void;
  /**
   * Report a user-initiated notice dismissal (Got it / strip click) so main can
   * expedite the window hide. Optional: a bridge without it degrades to "panel
   * exits, window lingers" (the pre-2026-06-12 behavior).
   */
  noticeDismissed?(): void;
  noticeAction?(id: "copy_text" | "open_permission_settings"): void;
};

const REQUIRED_CAPSULE_METHODS = [
  "onVoiceRuntime",
  "onCaptureControl",
  "capture_started",
  "push_capture_audio",
  "push_capture_level",
  "report_capture_error",
] as const satisfies readonly (keyof CapsuleBridge)[];

export function getCapsuleBridge(): CapsuleBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as Window & { soto?: Partial<SotoBridge> }).soto;
  if (!bridge) return null;

  for (const method of REQUIRED_CAPSULE_METHODS) {
    if (typeof bridge[method] !== "function") return null;
  }

  return bridge as CapsuleBridge;
}
