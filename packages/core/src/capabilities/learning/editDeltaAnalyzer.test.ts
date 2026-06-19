import { describe, expect, it } from "vitest";
import {
  analyzeEditDelta,
  hotwordCandidatesFromObservedEdit,
  isLearningEventEligibleForAutoLearn,
} from "./editDeltaAnalyzer.js";
import type { LearningObservationEvent } from "./pipeline.js";

const baseEvent: LearningObservationEvent = {
  historyId: "history.1",
  injectedText: "open browser",
  observedText: "open browser",
  confidence: "high",
  terminalSignal: "focus_lost",
  observedAt: 1_700_000_000_000n,
};

describe("analyzeEditDelta", () => {
  it("returns unchanged when observed text equals injected text", () => {
    expect(
      analyzeEditDelta({
        injectedText: "open browser",
        observedText: "open browser",
      }),
    ).toEqual({
      kind: "unchanged",
      insertedText: "",
      removedText: "",
    });
  });

  it("expands an in-word replacement to the whole edited token", () => {
    expect(
      analyzeEditDelta({
        injectedText: "Use Dobo today",
        observedText: "Use Doubao today",
      }),
    ).toEqual({
      kind: "edited",
      insertedText: "Doubao",
      removedText: "Dobo",
    });
  });

  it("does not return unchanged middle tokens for separated edits", () => {
    expect(
      analyzeEditDelta({
        injectedText: "Use Dobo with Zoom today",
        observedText: "Use Doubao with Zoom now",
      }),
    ).toEqual({
      kind: "edited",
      insertedText: "Doubao now",
      removedText: "Dobo today",
    });
  });
});

describe("isLearningEventEligibleForAutoLearn", () => {
  it("accepts only high-confidence real terminal signals", () => {
    expect(isLearningEventEligibleForAutoLearn(baseEvent)).toBe(true);
    expect(
      isLearningEventEligibleForAutoLearn({
        ...baseEvent,
        terminalSignal: "timeout_snapshot",
      }),
    ).toBe(false);
    expect(
      isLearningEventEligibleForAutoLearn({
        ...baseEvent,
        confidence: "medium",
      }),
    ).toBe(false);
  });
});

describe("hotwordCandidatesFromObservedEdit", () => {
  it("filters candidates from the edited delta, not the whole observed text", () => {
    expect(
      hotwordCandidatesFromObservedEdit(
        {
          ...baseEvent,
          observedText: "open browser then use Doubao",
        },
        new Set(),
      ),
    ).toEqual(["Doubao"]);
  });

  it("does not emit unchanged hotword-shaped tokens for punctuation-only appends", () => {
    expect(
      hotwordCandidatesFromObservedEdit(
        {
          ...baseEvent,
          injectedText: "Launch Zoom",
          observedText: "Launch Zoom.",
        },
        new Set(),
      ),
    ).toEqual([]);
  });

  it("does not emit unchanged tokens for unicode punctuation-only appends", () => {
    expect(
      hotwordCandidatesFromObservedEdit(
        {
          ...baseEvent,
          injectedText: "Launch Zoom",
          observedText: "Launch Zoom。",
        },
        new Set(),
      ),
    ).toEqual([]);
  });

  it("does not include the previous token when appending a new term", () => {
    expect(
      hotwordCandidatesFromObservedEdit(
        {
          ...baseEvent,
          injectedText: "Launch Zoom",
          observedText: "Launch Zoom Doubao",
        },
        new Set(),
      ),
    ).toEqual(["Doubao"]);
  });

  it("uses unicode punctuation as a boundary for appended terms", () => {
    expect(
      hotwordCandidatesFromObservedEdit(
        {
          ...baseEvent,
          injectedText: "Launch Zoom",
          observedText: "Launch Zoom，Doubao",
        },
        new Set(),
      ),
    ).toEqual(["Doubao"]);
  });

  it("uses underscores as ASCII punctuation boundaries for appended terms", () => {
    expect(
      hotwordCandidatesFromObservedEdit(
        {
          ...baseEvent,
          injectedText: "Launch Zoom",
          observedText: "Launch Zoom_Doubao",
        },
        new Set(),
      ),
    ).toEqual(["Doubao"]);
  });

  it("does not emit unchanged tokens between two separated edits", () => {
    expect(
      hotwordCandidatesFromObservedEdit(
        {
          ...baseEvent,
          injectedText: "Use Dobo with Zoom today",
          observedText: "Use Doubao with Zoom now",
        },
        new Set(),
      ),
    ).toEqual(["Doubao"]);
  });

  it("does not emit CJK candidates that include unseparated unchanged text", () => {
    expect(
      hotwordCandidatesFromObservedEdit(
        {
          ...baseEvent,
          injectedText: "打开豆包",
          observedText: "打开豆包钉钉",
        },
        new Set(),
      ),
    ).toEqual([]);
  });

  it("does not emit mixed-script candidates with an unchanged CJK prefix", () => {
    for (const observedText of ["打开豆包AI", "打开豆包123", "打开豆包ドラゴン"]) {
      expect(
        hotwordCandidatesFromObservedEdit(
          {
            ...baseEvent,
            injectedText: "打开豆包",
            observedText,
          },
          new Set(),
        ),
      ).toEqual([]);
    }
  });

  it("does not emit kana or hangul candidates with an unchanged prefix", () => {
    for (const [injectedText, observedText] of [
      ["Launch ドラゴン", "Launch ドラゴンAI"],
      ["Launch 한글", "Launch 한글AI"],
    ] satisfies Array<[string, string]>) {
      expect(
        hotwordCandidatesFromObservedEdit(
          {
            ...baseEvent,
            injectedText,
            observedText,
          },
          new Set(),
        ),
      ).toEqual([]);
    }
  });

  it("does not produce candidates for low-confidence observations", () => {
    expect(
      hotwordCandidatesFromObservedEdit(
        {
          ...baseEvent,
          observedText: "open browser then use Doubao",
          confidence: "low",
        },
        new Set(),
      ),
    ).toEqual([]);
  });

  it("does not produce candidates for timeout snapshots", () => {
    expect(
      hotwordCandidatesFromObservedEdit(
        {
          ...baseEvent,
          observedText: "open browser then use Doubao",
          terminalSignal: "timeout_snapshot",
        },
        new Set(),
      ),
    ).toEqual([]);
  });
});
