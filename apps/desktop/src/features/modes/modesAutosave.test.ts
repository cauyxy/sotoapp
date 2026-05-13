import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AUTOSAVE_DELAY_MS,
  createModeAutosaveController
} from "./modesAutosave";

describe("mode autosave controller", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves once after the debounce window when the draft is dirty", async () => {
    vi.useFakeTimers();
    let currentKey = "dirty-prompt";
    const save = vi.fn(() => {
      currentKey = "saved-prompt";
    });
    const controller = createModeAutosaveController({
      getCurrentKey: () => currentKey,
      getPersistedKey: () => "saved-prompt",
      save
    });

    expect(controller.schedule()).toBe(true);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 1);
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("resets the debounce window so consecutive edits save only the latest draft", async () => {
    vi.useFakeTimers();
    let currentKey = "first-edit";
    const savedKeys: string[] = [];
    const controller = createModeAutosaveController({
      getCurrentKey: () => currentKey,
      getPersistedKey: () => "clean",
      save: () => {
        savedKeys.push(currentKey);
      }
    });

    controller.schedule();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 100);
    currentKey = "second-edit";
    controller.schedule();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 1);
    expect(savedKeys).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(savedKeys).toEqual(["second-edit"]);
  });

  it("flushes a pending dirty draft immediately", async () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const controller = createModeAutosaveController({
      getCurrentKey: () => "dirty",
      getPersistedKey: () => "clean",
      save
    });

    controller.schedule();
    await expect(controller.flush()).resolves.toBe(true);
    expect(save).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
