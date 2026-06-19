// Debounced autosave controller — port of apps/desktop/src/features/modes/
// modesAutosave.ts. Framework-agnostic; the React page schedules() on draft
// change and flush()es on navigate-away / unmount. Saves only when the current
// key differs from the last-persisted key (so no-op edits don't round-trip).

export const AUTOSAVE_DELAY_MS = 500;

type TimerId = ReturnType<typeof setTimeout>;

export interface AutosaveControllerOptions {
  getCurrentKey: () => string | null;
  getPersistedKey: () => string | null;
  save: () => Promise<void> | void;
  delayMs?: number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}

export interface AutosaveController {
  schedule(): boolean;
  flush(): Promise<boolean>;
  clear(): void;
  hasPending(): boolean;
}

export function createAutosaveController({
  getCurrentKey,
  getPersistedKey,
  save,
  delayMs = AUTOSAVE_DELAY_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}: AutosaveControllerOptions): AutosaveController {
  let timer: TimerId | null = null;

  function clear(): void {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  }

  function shouldSave(): boolean {
    const currentKey = getCurrentKey();
    return currentKey !== null && currentKey !== getPersistedKey();
  }

  return {
    schedule(): boolean {
      clear();
      if (!shouldSave()) return false;
      timer = setTimer(() => {
        timer = null;
        if (shouldSave()) {
          void Promise.resolve(save()).catch((error) =>
            console.error("autosave: save failed", error),
          );
        }
      }, delayMs);
      return true;
    },
    async flush(): Promise<boolean> {
      clear();
      if (!shouldSave()) return false;
      await save();
      return true;
    },
    clear,
    hasPending(): boolean {
      return timer !== null;
    },
  };
}
