import { describe, expect, it } from "vitest";
import { NoopLearningPipeline } from "./pipeline.js";

describe("NoopLearningPipeline", () => {
  it("accepts observation events without side effects", async () => {
    await expect(
      NoopLearningPipeline.consume({
        historyId: "history.1",
        injectedText: "final text",
        observedText: "final edited text",
        confidence: "high",
        terminalSignal: "focus_lost",
        observedAt: 1_700_000_000_000n,
      }),
    ).resolves.toBeUndefined();
  });
});
