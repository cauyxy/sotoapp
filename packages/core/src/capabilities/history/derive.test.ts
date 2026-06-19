import { describe, expect, it } from "vitest";

import type { HistoryRecord } from "../../contract/schema.js";
import {
  dayBucketLabel,
  filterHistoryRecords,
  historyDesignGroups,
  historyFilterChips,
  historyGroupKey,
  historyMatchesFilter,
} from "./derive.js";

// Minimal HistoryRecord factory: every field these functions read is settable,
// the rest carry inert defaults so each test states only what it exercises.
function record(over: Partial<HistoryRecord> = {}): HistoryRecord {
  return {
    id: "r1",
    created_at: 0n,
    raw_text: "",
    processed_text: null,
    injected_text: null,
    edited_text: null,
    edited_text_status: "unavailable",
    edited_text_status_reason: null,
    mode_id: null,
    status: "completed",
    injection_outcome: { kind: "no_op" },
    speaking_duration_ms: 0n,
    char_count: 0,
    target_app: null,
    target_app_name: null,
    target_window_title: null,
    target_control_type: null,
    ax_context_at_start: null,
    ax_context_at_end: null,
    audio_path: null,
    provider_id: null,
    model_id: null,
    llm_provider_id: null,
    llm_model_id: null,
    detected_language: null,
    mic_device_id: null,
    ...over,
  };
}

describe("filterHistoryRecords", () => {
  it("returns the input unchanged for a blank/whitespace query", () => {
    const records = [record({ id: "a" }), record({ id: "b" })];
    expect(filterHistoryRecords(records, "")).toBe(records);
    expect(filterHistoryRecords(records, "   ")).toBe(records);
  });

  it("matches case-insensitively across the searchable fields", () => {
    const records = [
      record({ id: "raw", raw_text: "Hello World" }),
      record({ id: "processed", processed_text: "polished PHRASE" }),
      record({ id: "injected", injected_text: "INJECTED text" }),
      record({ id: "app", target_app: "com.example.App" }),
      record({ id: "title", target_window_title: "Untitled Document" }),
      record({ id: "none", raw_text: "nothing here" }),
    ];
    expect(filterHistoryRecords(records, "world").map((r) => r.id)).toEqual(["raw"]);
    expect(filterHistoryRecords(records, "phrase").map((r) => r.id)).toEqual(["processed"]);
    expect(filterHistoryRecords(records, "injected").map((r) => r.id)).toEqual(["injected"]);
    expect(filterHistoryRecords(records, "example").map((r) => r.id)).toEqual(["app"]);
    expect(filterHistoryRecords(records, "document").map((r) => r.id)).toEqual(["title"]);
  });
});

describe("historyFilterChips", () => {
  const MODE_IDS = ["default", "translate"] as const;

  it("emits an All chip plus one chip per supplied mode id, in order", () => {
    const chips = historyFilterChips([], MODE_IDS);
    expect(chips.map((c) => c.id)).toEqual(["all", "mode:default", "mode:translate"]);
    expect(chips[0]).toEqual({ id: "all", kind: "all", count: 0 });
  });

  it("counts records per mode; non-supplied mode ids count only toward All", () => {
    const records = [
      record({ id: "a", mode_id: "default" }),
      record({ id: "b", mode_id: "default" }),
      record({ id: "c", mode_id: "translate" }),
      record({ id: "d", mode_id: "custom-foreign" }),
      record({ id: "e", mode_id: null }),
    ];
    const chips = historyFilterChips(records, MODE_IDS);
    expect(chips[0]).toEqual({ id: "all", kind: "all", count: 5 });
    expect(chips[1]).toMatchObject({ modeId: "default", count: 2 });
    expect(chips[2]).toMatchObject({ modeId: "translate", count: 1 });
  });
});

describe("historyMatchesFilter", () => {
  it("treats empty / 'all' as match-all", () => {
    expect(historyMatchesFilter(record({ mode_id: "translate" }), "")).toBe(true);
    expect(historyMatchesFilter(record({ mode_id: "translate" }), "all")).toBe(true);
  });

  it("matches a mode:<id> filter against the record's mode_id", () => {
    expect(historyMatchesFilter(record({ mode_id: "default" }), "mode:default")).toBe(true);
    expect(historyMatchesFilter(record({ mode_id: "default" }), "mode:translate")).toBe(false);
  });

  it("ignores unknown filter kinds (match-all fallthrough)", () => {
    expect(historyMatchesFilter(record({ mode_id: "default" }), "weird:thing")).toBe(true);
  });
});

describe("dayBucketLabel", () => {
  const now = new Date(2026, 4, 30, 12, 0, 0); // 2026-05-30 12:00 local

  it("returns the unknown bucket for non-positive / unparseable timestamps", () => {
    expect(dayBucketLabel(record({ created_at: 0n }), now)).toEqual({
      primaryKind: "unknown",
      primaryMonth: null,
      primaryDay: null,
      date: "",
    });
  });

  it("labels same-day records as today (and any earlier clock time today)", () => {
    const todayMorning = new Date(2026, 4, 30, 6, 30, 0).getTime();
    const label = dayBucketLabel(record({ created_at: BigInt(todayMorning) }), now);
    expect(label.primaryKind).toBe("today");
    expect(label.date).toBe("May 30");
  });

  it("labels the prior day as yesterday", () => {
    const yesterday = new Date(2026, 4, 29, 23, 0, 0).getTime();
    expect(dayBucketLabel(record({ created_at: BigInt(yesterday) }), now).primaryKind).toBe(
      "yesterday",
    );
  });

  it("labels older records as monthDay with padded month/day + abbreviated date", () => {
    const older = new Date(2026, 2, 5, 9, 0, 0).getTime(); // Mar 5
    const label = dayBucketLabel(record({ created_at: BigInt(older) }), now);
    expect(label).toEqual({
      primaryKind: "monthDay",
      primaryMonth: "03",
      primaryDay: "05",
      date: "Mar 05",
    });
  });
});

describe("historyGroupKey", () => {
  it("is stable for equal label tuples and distinguishes differing ones", () => {
    const a = { primaryKind: "monthDay", primaryMonth: "03", primaryDay: "05", date: "Mar 05" };
    const b = { primaryKind: "monthDay", primaryMonth: "03", primaryDay: "06", date: "Mar 06" };
    expect(historyGroupKey(a)).toBe(historyGroupKey({ ...a }));
    expect(historyGroupKey(a)).not.toBe(historyGroupKey(b));
  });

  it("renders null month/day as empty segments", () => {
    expect(
      historyGroupKey({ primaryKind: "today", primaryMonth: null, primaryDay: null, date: "May 30" }),
    ).toBe("today|||May 30");
  });
});

describe("historyDesignGroups", () => {
  const now = new Date(2026, 4, 30, 12, 0, 0);

  it("groups by day bucket, newest record first within each group", () => {
    const t1 = new Date(2026, 4, 30, 9, 0, 0).getTime();
    const t2 = new Date(2026, 4, 30, 10, 30, 0).getTime();
    const t3 = new Date(2026, 4, 29, 8, 0, 0).getTime();
    const records = [
      record({ id: "early-today", created_at: BigInt(t1), raw_text: "a" }),
      record({ id: "late-today", created_at: BigInt(t2), raw_text: "b" }),
      record({ id: "yesterday", created_at: BigInt(t3), raw_text: "c" }),
    ];
    const groups = historyDesignGroups(records, now, "all", "");
    expect(groups).toHaveLength(2);
    expect(groups[0]?.primaryKind).toBe("today");
    // newest-first ordering: 10:30 before 09:00
    expect(groups[0]?.rows.map((r) => r.id)).toEqual(["late-today", "early-today"]);
    expect(groups[1]?.primaryKind).toBe("yesterday");
  });

  it("applies the text query and mode filter before grouping", () => {
    const ts = new Date(2026, 4, 30, 9, 0, 0).getTime();
    const records = [
      record({ id: "keep", created_at: BigInt(ts), mode_id: "default", raw_text: "alpha" }),
      record({ id: "wrong-mode", created_at: BigInt(ts), mode_id: "translate", raw_text: "alpha" }),
      record({ id: "wrong-text", created_at: BigInt(ts), mode_id: "default", raw_text: "beta" }),
    ];
    const groups = historyDesignGroups(records, now, "mode:default", "alpha");
    expect(groups).toHaveLength(1);
    expect(groups[0]?.rows.map((r) => r.id)).toEqual(["keep"]);
  });

  it("derives row fields: time, duration clock, polished pick, raw dedup", () => {
    const ts = new Date(2026, 4, 30, 9, 5, 7).getTime();
    const groups = historyDesignGroups(
      [
        record({
          id: "row",
          created_at: BigInt(ts),
          speaking_duration_ms: 95_000n, // 1:35
          char_count: 42,
          mode_id: "default",
          raw_text: "raw spoken",
          processed_text: "polished output",
          injected_text: null,
        }),
      ],
      now,
      "all",
      "",
    );
    const row = groups[0]?.rows[0];
    expect(row).toMatchObject({
      id: "row",
      time: "09:05:07",
      duration: "1:35",
      chars: 42,
      mode: "default",
      polished: "polished output",
      raw: "raw spoken", // differs from polished -> surfaced
      status: "completed",
    });
  });

  it("nulls the raw line when raw equals the polished text", () => {
    const ts = new Date(2026, 4, 30, 9, 0, 0).getTime();
    const groups = historyDesignGroups(
      [record({ id: "row", created_at: BigInt(ts), raw_text: "same", injected_text: "same" })],
      now,
      "all",
      "",
    );
    expect(groups[0]?.rows[0]?.raw).toBeNull();
    expect(groups[0]?.rows[0]?.polished).toBe("same");
  });

  it("falls back to an em-dash mode label and clamps negative char counts", () => {
    const ts = new Date(2026, 4, 30, 9, 0, 0).getTime();
    const groups = historyDesignGroups(
      [record({ id: "row", created_at: BigInt(ts), mode_id: null, char_count: -5 })],
      now,
      "all",
      "",
    );
    expect(groups[0]?.rows[0]?.mode).toBe("—");
    expect(groups[0]?.rows[0]?.chars).toBe(0);
  });
});
