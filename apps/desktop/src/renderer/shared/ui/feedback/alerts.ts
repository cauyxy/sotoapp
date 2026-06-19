// Alert stack state machine — ported verbatim from the old Svelte build, minus
// the previous desktop shell `listen` import. The cross-window `alert:show` broadcast bridge is
// not yet exposed via the Electron preload, so `startAlertListener()` is a
// no-op for now (deferred to a later pass). `pushAlert`/`removeAlert` work
// in-process so the host renders correctly when alerts are pushed locally.

export const AlertLevel = {
  BLOCKING: 0,
  PERSISTENT: 1,
  TEMPORARY: 2,
} as const;
export type AlertLevel = (typeof AlertLevel)[keyof typeof AlertLevel];

export interface Alert {
  id: string;
  level: AlertLevel;
  title: string;
  body?: string;
  action?: { label: string; handler: () => void };
  ttl?: number;
  createdAt: number;
}

const TEMPORARY_DEFAULT_TTL = 4000;
const PERSISTENT_DEFAULT_TTL = Number.POSITIVE_INFINITY;
const MAX_VISIBLE = 3;

let alerts: Alert[] = [];
let visibleSnapshot: Alert[] = [];
type Listener = () => void;
const listeners = new Set<Listener>();

function notifyListeners(): void {
  for (const l of listeners) l();
}

function refreshVisibleSnapshot(): void {
  // BLOCKING always shown; others capped at MAX_VISIBLE total
  const blocking = alerts.filter((a) => a.level === AlertLevel.BLOCKING);
  const others = alerts.filter((a) => a.level !== AlertLevel.BLOCKING);
  visibleSnapshot = [...blocking, ...others.slice(0, MAX_VISIBLE - blocking.length)];
}

/** Subscribe to alert state changes. Returns an unsubscribe function. */
export function subscribeAlerts(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function ttlFor(level: AlertLevel, override?: number): number {
  if (level === AlertLevel.BLOCKING) return Number.POSITIVE_INFINITY;
  return override ?? (level === AlertLevel.TEMPORARY ? TEMPORARY_DEFAULT_TTL : PERSISTENT_DEFAULT_TTL);
}

export function pushAlert(input: Omit<Alert, "createdAt">): void {
  const next: Alert = { ...input, createdAt: Date.now() };
  // Same id → replace existing
  alerts = alerts.filter((a) => a.id !== input.id);
  alerts = [...alerts, next];
  // Sort by priority (lower level = higher priority) then most-recent first
  alerts.sort((a, b) => a.level - b.level || b.createdAt - a.createdAt);
  refreshVisibleSnapshot();
  notifyListeners();
  // Schedule TTL auto-dismiss
  const ttl = ttlFor(next.level, next.ttl);
  if (Number.isFinite(ttl)) {
    setTimeout(() => removeAlert(next.id), ttl);
  }
}

export function removeAlert(id: string): void {
  alerts = alerts.filter((a) => a.id !== id);
  refreshVisibleSnapshot();
  notifyListeners();
}

export function visibleAlerts(): Alert[] {
  return visibleSnapshot;
}

export function getAlerts(): Alert[] {
  return alerts;
}

/** Test-only: reset all alert state. */
export function _resetForTesting(): void {
  alerts = [];
  visibleSnapshot = [];
  notifyListeners();
}

/**
 * Register the cross-window broadcast listener. The Electron preload does not
 * yet expose the `alert:show` channel, so this is a no-op returning a no-op
 * cleanup. Wiring the real listener is deferred to the pages pass once the
 * bridge exposes an `onAlert` method.
 */
export function startAlertListener(): () => void {
  return () => {};
}
