// Tiny clock-label formatters shared by the history + stats derivations.
// Pure (no Date.now, no locale APIs): every function formats an injected
// timestamp/duration, so output is deterministic in tests.

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** "HH:MM" for a unix-ms timestamp, or "—" when unparseable/zero. */
export function timeOfDayLabel(tsMs: bigint): string {
  const time = Number(tsMs);
  if (!Number.isFinite(time) || time <= 0) return "—";
  const date = new Date(time);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** "HH:MM:SS" for a unix-ms timestamp, or "—" when unparseable/zero. */
export function timeOfDayWithSecondsLabel(tsMs: bigint): string {
  const time = Number(tsMs);
  if (!Number.isFinite(time) || time <= 0) return "—";
  const date = new Date(time);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

/** "M:SS" clock label for a duration in milliseconds (rounded to seconds). */
export function clockDurationLabel(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${pad2(seconds)}`;
}
