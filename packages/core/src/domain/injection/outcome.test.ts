import { describe, expect, it } from "vitest";
import { sessionStatusFor } from "./outcome.js";

describe("sessionStatusFor", () => {
  it("classifies empty raw text as empty regardless of injection outcome", () => {
    expect(sessionStatusFor("", { kind: "paste_sent" })).toBe("empty");
  });

  it("classifies a failed injection of real text as failed", () => {
    expect(sessionStatusFor("hi", { kind: "failed", detail: "boom" })).toBe("failed");
  });

  it("classifies a focus_lost injection as failed", () => {
    expect(
      sessionStatusFor("hi", {
        kind: "focus_lost",
        detail: { saved_app_name: "Notes", actual_app_name: "Terminal" },
      }),
    ).toBe("failed");
  });

  it("classifies a successful injection of real text as completed", () => {
    expect(sessionStatusFor("hi", { kind: "paste_sent" })).toBe("completed");
  });
});
