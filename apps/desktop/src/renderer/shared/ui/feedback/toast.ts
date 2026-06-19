// Framework-agnostic toast state (ported verbatim from the old Svelte build,
// minus the Svelte `readable` store). React subscribes via useSyncExternalStore
// (see ToastHost.tsx). The imperative `toast(text)` is unchanged so any caller
// can fire a toast.

export const TOAST_DURATION_MS = 1500;

export interface ToastItem {
  id: string;
  text: string;
}

type Listener = () => void;

let toasts: ReadonlyArray<ToastItem> = [];
const listeners = new Set<Listener>();
let nextId = 0;

function emit(): void {
  for (const listener of listeners) listener();
}

function nextToastId(): string {
  nextId += 1;
  return `toast-${nextId}`;
}

export function toast(text: string): void {
  const id = nextToastId();
  toasts = [...toasts, { id, text }];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((item) => item.id !== id);
    emit();
  }, TOAST_DURATION_MS);
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function peekToasts(): ReadonlyArray<ToastItem> {
  return toasts;
}
