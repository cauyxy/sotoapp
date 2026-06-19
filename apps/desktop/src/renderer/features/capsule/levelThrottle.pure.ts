// Peak-hold level throttle for the capsule's live meter. The AudioWorklet
// delivers a per-quantum RMS every ~2.7ms (~375 Hz); pushing each one over IPC
// (which main echoes back) would flood the renderer<->main boundary, so the
// meter emits at ~30 Hz. The old gate simply DROPPED every sample between
// emits — a syllable-onset transient landing in the gap was permanently lost,
// which made the wave feel deaf to speech. This throttle instead accumulates
// the MAX level seen inside each window, so the loudest quantum of a syllable
// is always what reaches the meter. IPC cadence is unchanged (<=1 emit per
// interval — Tenet 6 budget held). Pure + injectable clock so it is testable
// in the node environment.

export const LEVEL_EMIT_INTERVAL_MS = 33;

export interface LevelThrottle {
  /**
   * Feed one quantum's RMS; returns the held window peak when the gate opens,
   * null while the window is still closed.
   */
  sample(level: number, nowMs: number): number | null;
  reset(): void;
}

export function createLevelThrottle(
  intervalMs: number = LEVEL_EMIT_INTERVAL_MS,
): LevelThrottle {
  // 0 → the first real sample always passes (performance.now() is large in
  // practice; same semantics as the old lastLevelEmitRef).
  let lastEmit = 0;
  let windowMax = 0;
  return {
    sample(level, nowMs) {
      if (level > windowMax) windowMax = level;
      if (nowMs - lastEmit < intervalMs) return null;
      lastEmit = nowMs;
      const peak = windowMax;
      windowMax = 0;
      return peak;
    },
    reset() {
      lastEmit = 0;
      windowMax = 0;
    },
  };
}
