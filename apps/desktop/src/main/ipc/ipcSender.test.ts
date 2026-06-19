import { describe, expect, it } from "vitest";

import { isMainWindowSender } from "./ipcSender";

describe("isMainWindowSender", () => {
  it("accepts only the main window webContents id", () => {
    expect(isMainWindowSender(42, 42)).toBe(true);
    expect(isMainWindowSender(7, 42)).toBe(false);
    expect(isMainWindowSender(42, null)).toBe(false);
    expect(isMainWindowSender(42, undefined)).toBe(false);
  });
});
