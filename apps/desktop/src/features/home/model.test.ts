import { beforeAll, describe, expect, it } from "vitest";

import { currentDateKicker } from "../../shared/nav";
import { recentTranscripts, weeklyOverview, type HomeStatRecord } from "./model";

// Pin navigator.language to en-US so `currentDateKicker` picks the YYYY.MM.DD
// branch regardless of the host's system locale. Node 21+ exposes a default
// `navigator` global that reflects the host locale, which varies by machine.
beforeAll(() => {
  Object.defineProperty(globalThis, "navigator", {
    value: { language: "en-US" },
    configurable: true
  });
});

describe("home page model", () => {
  function localIso(year: number, month: number, day: number, hour = 12, minute = 0): string {
    return new Date(year, month - 1, day, hour, minute).toISOString();
  }

  function rec(
    overrides: Partial<HomeStatRecord & { id: string }>
  ): HomeStatRecord & { id: string } {
    return {
      id: "rec-default",
      created_at: localIso(2026, 5, 10, 12, 0),
      char_count: 0,
      speaking_duration_ms: 0,
      processing_mode: "Quick",
      final_text: "",
      processed_text: null,
      raw_text: "",
      status: "completed",
      ...overrides
    };
  }

  it("formats today's date as YYYY.MM.DD · WEEKDAY in en locale", () => {
    const result = currentDateKicker(new Date(2026, 4, 7), [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday"
    ]);
    expect(result).toBe("2026.05.07 · Thursday");
  });

  it("uses caller-supplied weekday labels when provided", () => {
    const labels = ["日", "一", "二", "三", "四", "五", "六"];
    const result = currentDateKicker(new Date(2026, 4, 7), labels);
    expect(result).toBe("2026.05.07 · 四");
  });

  it("recentTranscripts orders by created_at desc and respects limit", () => {
    const records = [
      rec({
        id: "a",
        created_at: localIso(2026, 5, 10, 8, 0),
        final_text: "morning post",
        char_count: 12
      }),
      rec({
        id: "b",
        created_at: localIso(2026, 5, 10, 15, 0),
        final_text: "afternoon post",
        char_count: 14
      }),
      rec({
        id: "c",
        created_at: localIso(2026, 5, 10, 20, 0),
        final_text: "evening post",
        char_count: 12
      })
    ];
    const recent = recentTranscripts(records, 2);
    expect(recent).toHaveLength(2);
    expect(recent[0].id).toBe("c");
    expect(recent[1].id).toBe("b");
    expect(recent[0].body).toBe("evening post");
    expect(recent[0].chars).toBe(12);
  });
});

describe("weeklyOverview", () => {
  function rec(overrides: Partial<HomeStatRecord>): HomeStatRecord {
    return {
      created_at: new Date(2026, 4, 11, 10).toISOString(),
      char_count: 0,
      speaking_duration_ms: 0,
      processing_mode: "default",
      final_text: "x",
      processed_text: null,
      raw_text: "x",
      status: "ok",
      ...overrides
    };
  }

  it("returns zeros with null avgCpm for empty history", () => {
    const out = weeklyOverview([], new Date(2026, 4, 11));
    expect(out).toEqual({
      speakMinutes: 0,
      characterCount: 0,
      savedMinutes: 0,
      avgCpm: null
    });
  });

  it("filters out records older than 7 days", () => {
    const now = new Date(2026, 4, 11); // May 11
    const oldRecord = rec({
      char_count: 100,
      speaking_duration_ms: 60_000,
      created_at: "2026-05-01T10:00:00Z" // 10 days ago
    });
    const out = weeklyOverview([oldRecord], now);
    expect(out.characterCount).toBe(0);
    expect(out.speakMinutes).toBe(0);
  });

  it("aggregates characters and speakMinutes for in-window records", () => {
    const now = new Date(2026, 4, 11, 12);
    const records = [
      rec({ char_count: 60, speaking_duration_ms: 60_000, created_at: "2026-05-10T10:00:00Z" }),
      rec({ char_count: 120, speaking_duration_ms: 120_000, created_at: "2026-05-11T11:00:00Z" })
    ];
    const out = weeklyOverview(records, now);
    expect(out.characterCount).toBe(180);
    expect(out.speakMinutes).toBe(3);
    expect(out.avgCpm).toBeGreaterThan(0);
  });

  it("computes savedMinutes against the TYPING_CPM baseline", () => {
    const now = new Date(2026, 4, 11, 12);
    // 100 chars spoken in 60s = 1 min speaking; typing at 50 cpm would be 2 min — saved 1 min.
    const records = [
      rec({ char_count: 100, speaking_duration_ms: 60_000, created_at: "2026-05-11T10:00:00Z" })
    ];
    const out = weeklyOverview(records, now);
    expect(out.savedMinutes).toBe(1);
  });

  it("returns null avgCpm if no record exceeds the speaking-ms threshold", () => {
    const now = new Date(2026, 4, 11, 12);
    // 60 chars in 100ms (below MIN_SPEAKING_MS_FOR_CPM = 500) — excluded from cpm
    const records = [
      rec({ char_count: 60, speaking_duration_ms: 100, created_at: "2026-05-11T10:00:00Z" })
    ];
    const out = weeklyOverview(records, now);
    expect(out.avgCpm).toBeNull();
  });
});
