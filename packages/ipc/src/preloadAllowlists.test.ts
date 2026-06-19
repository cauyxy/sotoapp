import { describe, expect, it } from "vitest";
import { ALL_COMMANDS, CAPSULE_COMMANDS, COMMAND_POLICY } from "./commands.js";
import { MAIN_COMMANDS } from "../../../apps/desktop/src/preload/index.commands.js";
import { CAPSULE_COMMANDS as CAPSULE_PRELOAD } from "../../../apps/desktop/src/preload/capsule.commands.js";

describe("preload allowlists mirror COMMAND_POLICY exactly", () => {
  it("main preload == all commands", () => {
    expect(new Set(MAIN_COMMANDS)).toEqual(new Set(ALL_COMMANDS));
  });

  it("capsule preload == derived capsule set", () => {
    expect(new Set(CAPSULE_PRELOAD)).toEqual(new Set(CAPSULE_COMMANDS));
  });

  it("has no selection-action commands", () => {
    const derived = ALL_COMMANDS.filter((name) => name.includes("selection"));

    expect(derived).toEqual([]);
  });
});
