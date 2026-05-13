import { describe, expect, it } from "vitest";

import { APP_COMMANDS } from "./app";

describe("app IPC model", () => {
  it("matches backend app lifecycle command names", () => {
    expect(APP_COMMANDS).toEqual({
      quitApp: "quit_app"
    });
  });
});
