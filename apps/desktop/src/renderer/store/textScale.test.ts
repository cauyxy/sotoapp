import { describe, expect, it } from "vitest";

import { textScaleMultiplier } from "./textScale";

describe("textScaleMultiplier", () => {
  it("maps the three steps", () => {
    expect(textScaleMultiplier("small")).toBe(1);
    expect(textScaleMultiplier("default")).toBe(1.15);
    expect(textScaleMultiplier("large")).toBe(1.28);
  });
});
