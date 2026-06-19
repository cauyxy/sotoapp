import { describe, expect, it } from "vitest";
import { shouldHideMainWindowOnClose } from "./windowLifecycle.pure.js";

describe("main window close lifecycle", () => {
  it("hides the Windows main window on a user close", () => {
    expect(shouldHideMainWindowOnClose("win32", false)).toBe(true);
  });

  it("allows close during an explicit quit", () => {
    expect(shouldHideMainWindowOnClose("win32", true)).toBe(false);
  });

  it("does not intercept close on macOS", () => {
    expect(shouldHideMainWindowOnClose("darwin", false)).toBe(false);
  });
});
