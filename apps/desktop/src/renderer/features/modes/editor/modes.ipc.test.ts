import { describe, expect, it } from "vitest";

import { orderModes } from "./modes.ipc";
import type { ModeRecord } from "./modes.ipc";

function mode(id: string, order: number, created = 0): ModeRecord {
  return {
    id,
    name: id,
    prompt_body: "",
    hotkey: null,
    display_order: order,
    built_in: id === "default",
    created_at: BigInt(created),
    updated_at: BigInt(created),
  };
}

describe("orderModes", () => {
  it("keeps custom modes and sorts by display_order then created_at", () => {
    const out = orderModes([
      mode("mode.b", 3, 20),
      mode("default", 0),
      mode("mode.a", 3, 10),
    ]);
    expect(out.map((m) => m.id)).toEqual(["default", "mode.a", "mode.b"]);
  });
});
