import { describe, expect, it } from "vitest";

import { tierPlanFor } from "./injectionPlan.js";

describe("tierPlanFor", () => {
  it("plans restorable-clipboard text as paste only", () => {
    expect(tierPlanFor({ text: "hello", clipboardSnapshotKind: "text" })).toEqual({
      text: "hello",
      tiers: ["paste"],
      manualFallbackReason: null,
      preferPaste: true,
    });
  });

  it("pastes multiline / terminal text without newline normalization", () => {
    const plan = tierPlanFor({ text: "hello\nworld", clipboardSnapshotKind: "text" });
    expect(plan.text).toBe("hello\nworld");
    expect(plan.tiers).toEqual(["paste"]);
  });

  it("pastes long text", () => {
    const long = "x".repeat(801);
    expect(tierPlanFor({ text: long, clipboardSnapshotKind: "text" }).tiers).toEqual([
      "paste",
    ]);
  });

  it("routes rich clipboards to copy-only manual fallback", () => {
    const plan = tierPlanFor({ text: "line 1\nline 2", clipboardSnapshotKind: "rich" });
    expect(plan.tiers).toEqual([]);
    expect(plan.manualFallbackReason).toBe("clipboard_unrestorable");
    expect(plan.preferPaste).toBe(false);
  });
});
