import { describe, expect, it } from "vitest";

import {
  HISTORY_COMMANDS,
  dayBucketLabel,
  filterHistoryRecords,
  historyDesignGroups,
  historyFilterChips,
  historyMatchesFilter,
  type HistoryRecord
} from "./history";

describe("history IPC model", () => {
  it("matches backend history command names", () => {
    expect(HISTORY_COMMANDS).toEqual({
      listHistory: "list_history",
      deleteHistoryRecord: "delete_history_record",
      clearHistory: "clear_history"
    });
  });

  it("searches raw, processed, final, and target metadata fields", () => {
    const records = [
      historyRecord("one", "2026-05-10T09:00:00Z", "raw dictation", null, "raw dictation"),
      historyRecord("two", "2026-05-10T10:00:00Z", "rough", "polished invoice", "polished invoice"),
      {
        ...historyRecord("three", "2026-05-09T10:00:00Z", "message", null, "message"),
        target_app: "Mail"
      }
    ];

    expect(filterHistoryRecords(records, "invoice").map((record) => record.id)).toEqual(["two"]);
    expect(filterHistoryRecords(records, "mail").map((record) => record.id)).toEqual(["three"]);
    expect(filterHistoryRecords(records, "  ").map((record) => record.id)).toEqual([
      "one",
      "two",
      "three"
    ]);
  });

});

function historyRecord(
  id: string,
  createdAt: string,
  rawText: string,
  processedText: string | null,
  finalText: string
): HistoryRecord {
  return {
    id,
    created_at: createdAt,
    raw_text: rawText,
    processing_mode: "direct",
    processed_text: processedText,
    final_text: finalText,
    status: "completed",
    injection_outcome: { kind: "inserted" },
    speaking_duration_ms: 1200,
    char_count: finalText.length,
    target_app: "Notes",
    target_window_title: "Draft",
    target_control_type: "text",
    provider_id: "mimo-plan-sea",
    model_id: "mimo-v2.5"
  };
}

describe("history design helpers", () => {
  const fixedNow = new Date(2026, 4, 10, 20, 30);

  function localIso(year: number, month: number, day: number, hour = 12, minute = 0): string {
    return new Date(year, month - 1, day, hour, minute).toISOString();
  }

  function rec(overrides: Partial<HistoryRecord>): HistoryRecord {
    return {
      ...historyRecord(
        overrides.id ?? "rec",
        overrides.created_at ?? localIso(2026, 5, 10, 12, 0),
        overrides.raw_text ?? "raw",
        overrides.processed_text ?? null,
        overrides.final_text ?? "final"
      ),
      ...overrides
    };
  }

  it("historyFilterChips returns fixed All + 2 canonical chips in canonical order", () => {
    const chips = historyFilterChips([
      rec({ id: "a", processing_mode: "default" }),
      rec({ id: "b", processing_mode: "translate" }),
      rec({ id: "c", processing_mode: "translate" })
    ]);
    expect(chips).toEqual([
      { id: "all", kind: "all", count: 3 },
      { id: "mode:default", kind: "mode", modeId: "default", count: 1 },
      { id: "mode:translate", kind: "mode", modeId: "translate", count: 2 }
    ]);
  });

  it("historyFilterChips emits zero-count canonical chips and ignores foreign modes", () => {
    const chips = historyFilterChips([
      rec({ id: "a", processing_mode: "default" }),
      rec({ id: "b", processing_mode: "Polish" }),
      rec({ id: "c", processing_mode: "" })
    ]);
    expect(chips.map((chip) => [chip.id, chip.count])).toEqual([
      ["all", 3],
      ["mode:default", 1],
      ["mode:translate", 0]
    ]);
  });

  it("historyMatchesFilter narrows by canonical mode id", () => {
    const record = rec({ id: "a", processing_mode: "default" });
    expect(historyMatchesFilter(record, "all")).toBe(true);
    expect(historyMatchesFilter(record, "mode:default")).toBe(true);
    expect(historyMatchesFilter(record, "mode:translate")).toBe(false);
  });

  it("dayBucketLabel returns a discriminated kind based on local-day distance", () => {
    expect(dayBucketLabel(rec({ created_at: localIso(2026, 5, 10, 10, 0) }), fixedNow)).toEqual({
      primaryKind: "today",
      primaryMonth: null,
      primaryDay: null,
      date: "May 10"
    });
    expect(dayBucketLabel(rec({ created_at: localIso(2026, 5, 9, 10, 0) }), fixedNow)).toEqual({
      primaryKind: "yesterday",
      primaryMonth: null,
      primaryDay: null,
      date: "May 09"
    });
    expect(dayBucketLabel(rec({ created_at: localIso(2026, 5, 7, 10, 0) }), fixedNow)).toEqual({
      primaryKind: "monthDay",
      primaryMonth: "05",
      primaryDay: "07",
      date: "May 07"
    });
  });

  it("historyDesignGroups groups newest-first and folds raw under polished", () => {
    const groups = historyDesignGroups(
      [
        rec({
          id: "today-a",
          created_at: localIso(2026, 5, 10, 21, 0),
          raw_text: "raw today",
          final_text: "polished today",
          char_count: 14
        }),
        rec({
          id: "yesterday",
          created_at: localIso(2026, 5, 9, 16, 0),
          raw_text: "same",
          final_text: "same",
          char_count: 4
        })
      ],
      fixedNow,
      "all",
      ""
    );
    expect(groups[0].primaryKind).toBe("today");
    expect(groups[0].rows[0].id).toBe("today-a");
    expect(groups[0].rows[0].raw).toBe("raw today");
    expect(groups[0].rows[0]).not.toHaveProperty("engine");
    expect(groups[1].primaryKind).toBe("yesterday");
    expect(groups[1].rows[0].raw).toBeNull();
  });
});
