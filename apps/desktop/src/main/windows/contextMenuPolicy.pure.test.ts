import { describe, expect, it } from "vitest";
import { contextMenuRoles } from "./contextMenuPolicy.pure.js";

describe("context menu policy", () => {
  it("offers full edit roles on an editable field", () => {
    expect(contextMenuRoles({ isEditable: true, selectionText: "" })).toEqual([
      "cut",
      "copy",
      "paste",
      "selectAll",
    ]);
  });

  it("offers only copy when there is a non-empty selection on read-only content", () => {
    expect(contextMenuRoles({ isEditable: false, selectionText: "hello" })).toEqual(["copy"]);
  });

  it("offers nothing on empty read-only chrome", () => {
    expect(contextMenuRoles({ isEditable: false, selectionText: "   " })).toEqual([]);
  });
});
