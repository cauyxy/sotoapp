import { describe, expect, it } from "vitest";

import { createWindowControlActions } from "./windowActions";

describe("window control actions", () => {
  it("delegates each control to the underlying window so the Rust close handler can intercept", async () => {
    const calls: string[] = [];
    const win = {
      minimize: () => {
        calls.push("minimize");
        return Promise.resolve();
      },
      toggleMaximize: () => {
        calls.push("toggleMaximize");
        return Promise.resolve();
      },
      close: () => {
        calls.push("close");
        return Promise.resolve();
      }
    };

    const actions = createWindowControlActions(win);

    await actions.minimize();
    await actions.toggleMaximize();
    await actions.close();

    expect(calls).toEqual(["minimize", "toggleMaximize", "close"]);
  });
});
