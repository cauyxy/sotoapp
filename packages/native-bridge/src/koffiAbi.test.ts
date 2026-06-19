import { describe, expect, it } from "vitest";

import { normalizeWindowsHookEventRaw } from "./koffiAbi.js";

describe("normalizeWindowsHookEventRaw", () => {
  it("maps Windows queued hook records to normalized key events", () => {
    expect(
      normalizeWindowsHookEventRaw({
        vkCode: 0xa3,
        scanCode: 0x1d,
        hookFlags: 0,
        wParam: 0x0104,
        modifiers: 0b1010,
        droppedCount: 7,
      }),
    ).toEqual({
      flags: 0b1010,
      key: 0xa3,
      scanCode: 0x1d,
      down: true,
      repeat: false,
      droppedCount: 7,
    });

    expect(
      normalizeWindowsHookEventRaw({
        vkCode: 0xa3,
        scanCode: 0x1d,
        hookFlags: 0,
        wParam: 0x0105,
        modifiers: 0,
        droppedCount: 0,
      }).down,
    ).toBe(false);
  });
});
