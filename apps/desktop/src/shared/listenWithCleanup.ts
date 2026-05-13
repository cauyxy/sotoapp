import { listen, type EventCallback, type EventName } from "@tauri-apps/api/event";

export function listenWithCleanup<T = unknown>(
  event: EventName,
  handler: EventCallback<T>,
  options?: { onError?: (error: unknown) => void }
): () => void {
  let cancelled = false;
  let unlisten: (() => void) | undefined;

  listen<T>(event, handler)
    .then((next) => {
      if (cancelled) next();
      else unlisten = next;
    })
    .catch((error) => options?.onError?.(error));

  return () => {
    cancelled = true;
    unlisten?.();
  };
}
