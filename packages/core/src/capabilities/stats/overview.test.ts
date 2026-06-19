import { describe, expect, it } from "vitest";
import {
  recentTranscripts,
  todayOverview,
  weeklyOverview,
  type HomeStatRecord,
} from "./overview.js";

function record(over: Partial<HomeStatRecord> = {}): HomeStatRecord {
  return {
    id: "r1",
    created_at: 0n,
    char_count: 0,
    speaking_duration_ms: 0n,
    mode_id: null,
    injected_text: null,
    processed_text: null,
    raw_text: "",
    status: "completed",
    ...over,
  };
}

describe("weeklyOverview", () => {
  const now = new Date(2026, 4, 30, 12, 0, 0);

  it("aggregates chars + minutes over the trailing 7 days", () => {
    const today = new Date(2026, 4, 30, 9, 0, 0).getTime();
    const history = [
      record({ id: "a", created_at: BigInt(today), char_count: 100, speaking_duration_ms: 60_000n }),
      record({ id: "b", created_at: BigInt(today), char_count: 50, speaking_duration_ms: 30_000n }),
    ];
    const out = weeklyOverview(history, now);
    expect(out.characterCount).toBe(150);
    expect(out.speakMinutes).toBe(2); // 90_000ms -> 1.5min -> round 2
    // avgCpm: (100/(1min) + 50/(0.5min)) / 2 = (100 + 100) / 2 = 100
    expect(out.avgCpm).toBe(100);
  });

  it("excludes records older than 7 days and clamps negatives", () => {
    const old = new Date(2026, 4, 20, 9, 0, 0).getTime(); // 10 days ago
    const out = weeklyOverview(
      [record({ created_at: BigInt(old), char_count: 999, speaking_duration_ms: 60_000n })],
      now,
    );
    expect(out.characterCount).toBe(0);
    expect(out.savedMinutes).toBe(0);
    expect(out.avgCpm).toBeNull();
  });

  it("ignores sub-threshold speaking durations for cpm but still counts chars", () => {
    const today = new Date(2026, 4, 30, 9, 0, 0).getTime();
    const out = weeklyOverview(
      [record({ created_at: BigInt(today), char_count: 10, speaking_duration_ms: 100n })],
      now,
    );
    expect(out.characterCount).toBe(10);
    expect(out.avgCpm).toBeNull(); // 100ms < MIN_SPEAKING_MS_FOR_CPM
  });
});

describe("todayOverview", () => {
  const DAY = 86_400_000;
  // 2026-06-12T08:00 local — fixed reference now (as milliseconds timestamp).
  const now = new Date(2026, 5, 12, 8, 0, 0).getTime();
  const startOfToday = new Date(2026, 5, 12, 0, 0, 0).getTime();

  function rec(at: number, chars: number, ms: number) {
    return record({
      created_at: BigInt(at),
      char_count: chars,
      speaking_duration_ms: BigInt(ms),
      status: "completed",
    });
  }

  it("counts only records from the local calendar day", () => {
    const out = todayOverview(
      [rec(startOfToday + 3_600_000, 100, 5_000), rec(startOfToday - DAY, 999, 9_000)],
      now,
    );
    expect(out.characterCount).toBe(100);
    expect(out.sessionCount).toBe(1);
    expect(out.avgSeconds).toBeCloseTo(5);
  });

  it("returns zeros on an empty day", () => {
    const out = todayOverview([], now);
    expect(out).toEqual({ characterCount: 0, sessionCount: 0, avgSeconds: 0 });
  });
});

describe("recentTranscripts", () => {
  it("returns the newest `limit` rows in descending time order", () => {
    const rows = recentTranscripts(
      [
        record({ id: "old", created_at: 1_000n, injected_text: "old" }),
        record({ id: "new", created_at: 3_000n, injected_text: "new" }),
        record({ id: "mid", created_at: 2_000n, processed_text: "mid" }),
      ],
      2,
    );
    expect(rows.map((r) => r.id)).toEqual(["new", "mid"]);
    expect(rows[0]!.body).toBe("new");
    expect(rows[1]!.body).toBe("mid");
  });

  it("falls back through injected -> processed -> raw for body, and '—' for missing fields", () => {
    const row = recentTranscripts([record({ raw_text: "raw only", char_count: -5 })], 1)[0]!;
    expect(row.body).toBe("raw only");
    expect(row.mode).toBe("—");
    expect(row.time).toBe("—"); // created_at 0 -> placeholder
    expect(row.chars).toBe(0); // clamped from -5
  });
});
