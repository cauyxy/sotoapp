export const AUTOSAVE_DELAY_MS = 500;

type TimerId = ReturnType<typeof setTimeout>;

type AutosaveControllerOptions = {
  getCurrentKey: () => string | null;
  getPersistedKey: () => string | null;
  save: () => Promise<void> | void;
  delayMs?: number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
};

// Phase C renamed `createModeAutosaveController` → `createAutosaveController` so
// the same controller can drive mode metadata and prompt body autosave independently.
export function createAutosaveController({
  getCurrentKey,
  getPersistedKey,
  save,
  delayMs = AUTOSAVE_DELAY_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout
}: AutosaveControllerOptions) {
  let timer: TimerId | null = null;

  function clear() {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  }

  function shouldSave() {
    const currentKey = getCurrentKey();
    return currentKey !== null && currentKey !== getPersistedKey();
  }

  return {
    schedule() {
      clear();
      if (!shouldSave()) return false;
      timer = setTimer(() => {
        timer = null;
        if (shouldSave()) void Promise.resolve(save()).catch((error) => console.error("autosave: save failed", error));
      }, delayMs);
      return true;
    },
    async flush() {
      clear();
      if (!shouldSave()) return false;
      await save();
      return true;
    },
    clear,
    hasPending() {
      return timer !== null;
    }
  };
}

// Legacy alias for the pre-Phase-C name.
export const createModeAutosaveController = createAutosaveController;
