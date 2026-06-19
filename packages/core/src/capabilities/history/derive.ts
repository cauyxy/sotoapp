// History derivation — pure, deterministic shaping over dictation history.
// Moved here from apps/desktop/src/renderer/pages/history/historyModel.ts so the
// filter / filter-chip / day-bucket / design-group logic lives alongside the
// other framework-free capabilities and is unit-tested in Node. Data-in/data-out:
// no React, no IPC. Reuses the contract-layer HistoryRecord (downward import).
//
// The canonical mode-id list (used only for the filter chips) is NOT hard-coded
// here — it is a renderer-owned product list, so historyFilterChips takes it as
// an argument and is generic over its element type. That keeps this module free
// of any renderer dependency while preserving the caller's chip id types.

import {
  clockDurationLabel,
  pad2,
  timeOfDayWithSecondsLabel,
} from "../../foundation/time/format.js";
import type { HistoryRecord, SessionStatus } from "../../contract/schema.js";

/**
 * Best display text for a transcript: injected ▸ processed ▸ raw. Structural so
 * the stats derivation (HomeStatRecord, a HistoryRecord subset) shares it.
 */
export function polishedTranscriptText(record: {
  injected_text: string | null;
  processed_text: string | null;
  raw_text: string;
}): string {
  return record.injected_text || record.processed_text || record.raw_text || "";
}

export function filterHistoryRecords(
  records: HistoryRecord[],
  query: string,
): HistoryRecord[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return records;
  }

  return records.filter((record) =>
    [
      record.raw_text,
      record.processed_text ?? "",
      record.injected_text ?? "",
      record.target_app ?? "",
      record.target_window_title ?? "",
    ]
      .join("\n")
      .toLowerCase()
      .includes(normalized),
  );
}

export type HistoryFilterChip<M extends string = string> =
  | { id: "all"; kind: "all"; count: number }
  | {
      id: `mode:${M}`;
      kind: "mode";
      modeId: M;
      count: number;
    };

// Returns a fixed chip set: "All" plus one chip per supplied canonical mode id,
// in the given order. Counts come from the records' mode_id field; modes with
// zero records still render. Records whose mode_id is not in modeIds contribute
// only to the "All" count. Generic over M so the caller's mode-id literal union
// flows through to the chip ids.
export function historyFilterChips<M extends string>(
  records: HistoryRecord[],
  modeIds: readonly M[],
): HistoryFilterChip<M>[] {
  const counts = new Map<M, number>();
  for (const modeId of modeIds) counts.set(modeId, 0);
  for (const record of records) {
    const modeId = (record.mode_id ?? "") as M;
    const current = counts.get(modeId);
    if (current !== undefined) counts.set(modeId, current + 1);
  }
  return [
    { id: "all", kind: "all", count: records.length },
    ...modeIds.map(
      (modeId): HistoryFilterChip<M> => ({
        id: `mode:${modeId}`,
        kind: "mode",
        modeId,
        count: counts.get(modeId) ?? 0,
      }),
    ),
  ];
}

export function historyMatchesFilter(
  record: HistoryRecord,
  filterId: string,
): boolean {
  if (!filterId || filterId === "all") return true;
  const [kind, value] = filterId.split(":", 2);
  if (kind === "mode") return record.mode_id === value;
  return true;
}

export type DayBucketLabel = {
  /** Discriminator the renderer uses to pick a translation key. `unknown` when created_at is unparseable. */
  primaryKind: "today" | "yesterday" | "monthDay" | "unknown";
  /** Two-digit month, present only when primaryKind === "monthDay". */
  primaryMonth: string | null;
  /** Two-digit day, present only when primaryKind === "monthDay". */
  primaryDay: string | null;
  /** English-format short date used as the secondary line. Locale-stable. */
  date: string;
};

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function dayBucketLabel(record: HistoryRecord, now: Date): DayBucketLabel {
  const time = Number(record.created_at);
  if (!Number.isFinite(time) || time <= 0) {
    return { primaryKind: "unknown", primaryMonth: null, primaryDay: null, date: "" };
  }
  const recordDate = new Date(time);
  const recordDay = new Date(
    recordDate.getFullYear(),
    recordDate.getMonth(),
    recordDate.getDate(),
  );
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round(
    (today.getTime() - recordDay.getTime()) / (24 * 60 * 60 * 1000),
  );
  const month = pad2(recordDate.getMonth() + 1);
  const day = pad2(recordDate.getDate());
  const date = `${MONTH_ABBR[recordDate.getMonth()]} ${day}`;
  if (diffDays <= 0) return { primaryKind: "today", primaryMonth: null, primaryDay: null, date };
  if (diffDays === 1)
    return { primaryKind: "yesterday", primaryMonth: null, primaryDay: null, date };
  return { primaryKind: "monthDay", primaryMonth: month, primaryDay: day, date };
}

export type HistoryDesignRow = {
  id: string;
  time: string;
  duration: string;
  chars: number;
  mode: string;
  polished: string;
  raw: string | null;
  status: SessionStatus;
};

export type HistoryDesignGroup = {
  primaryKind: DayBucketLabel["primaryKind"];
  primaryMonth: string | null;
  primaryDay: string | null;
  date: string;
  rows: HistoryDesignRow[];
};

function rawTextOf(record: HistoryRecord): string | null {
  const polished = polishedTranscriptText(record);
  if (!record.raw_text || record.raw_text === polished) return null;
  return record.raw_text;
}

export function historyGroupKey(group: {
  primaryKind: string;
  primaryMonth: string | null;
  primaryDay: string | null;
  date: string;
}): string {
  return `${group.primaryKind}|${group.primaryMonth ?? ""}|${group.primaryDay ?? ""}|${group.date}`;
}

export function historyDesignGroups(
  records: HistoryRecord[],
  now: Date,
  filterId: string,
  query: string,
): HistoryDesignGroup[] {
  const filtered = filterHistoryRecords(records, query).filter((record) =>
    historyMatchesFilter(record, filterId),
  );
  const ordered = [...filtered].sort((left, right) => {
    const l = Number(left.created_at);
    const r = Number(right.created_at);
    return r - l;
  });
  const groups = new Map<string, HistoryDesignGroup>();
  for (const record of ordered) {
    const labels = dayBucketLabel(record, now);
    const key = historyGroupKey(labels);
    let group = groups.get(key);
    if (!group) {
      group = {
        primaryKind: labels.primaryKind,
        primaryMonth: labels.primaryMonth,
        primaryDay: labels.primaryDay,
        date: labels.date,
        rows: [],
      };
      groups.set(key, group);
    }
    group.rows.push({
      id: record.id,
      time: timeOfDayWithSecondsLabel(record.created_at),
      duration: clockDurationLabel(Number(record.speaking_duration_ms)),
      chars: Math.max(0, record.char_count),
      mode: record.mode_id || "—",
      polished: polishedTranscriptText(record),
      raw: rawTextOf(record),
      status: record.status,
    });
  }
  return Array.from(groups.values());
}
