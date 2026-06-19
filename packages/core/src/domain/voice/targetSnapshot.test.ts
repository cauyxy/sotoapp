import { describe, expect, it } from "vitest";
import { selectedTextOf } from "./targetSnapshot.js";
import type { AxContext } from "../../contract/schema.js";

function ax(partial: Partial<AxContext>): AxContext {
  return {
    full_text: "",
    selection_start: 0,
    selection_end: 0,
    before: "",
    after: "",
    ax_role: null,
    app_bundle_id: null,
    app_name: null,
    window_title: null,
    web_url: null,
    web_domain: null,
    ...partial,
  };
}

describe("selectedTextOf", () => {
  it("returns the substring between selection_start and selection_end", () => {
    expect(
      selectedTextOf(ax({ full_text: "hello world", selection_start: 6, selection_end: 11 })),
    ).toBe("world");
  });

  it("returns '' when nothing is selected (start === end)", () => {
    expect(selectedTextOf(ax({ full_text: "hello", selection_start: 2, selection_end: 2 }))).toBe("");
  });

  it("returns '' for a null context", () => {
    expect(selectedTextOf(null)).toBe("");
  });
});
