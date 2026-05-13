import { invoke } from "@tauri-apps/api/core";

import {
  CANONICAL_MODE_IDS,
  isCanonicalModeId,
  type CanonicalModeId
} from "../shared/modes";

export const HISTORY_COMMANDS = {
  listHistory: "list_history",
  deleteHistoryRecord: "delete_history_record",
  clearHistory: "clear_history"
} as const;

export type SessionStatus = "completed" | "empty" | "failed" | "cancelled";

export type InjectionOutcome =
  | { kind: "inserted" }
  | { kind: "paste_sent" }
  | { kind: "copied_fallback" }
  | { kind: "no_op" }
  | { kind: "failed"; detail: string };

export interface HistoryRecord {
  id: string;
  created_at: string;
  raw_text: string;
  processing_mode: string;
  processed_text: string | null;
  final_text: string;
  status: SessionStatus;
  injection_outcome: InjectionOutcome;
  speaking_duration_ms: number;
  char_count: number;
  target_app: string;
  target_window_title: string;
  target_control_type: string;
  provider_id: string | null;
  model_id: string | null;
}

export function filterHistoryRecords(records: HistoryRecord[], query: string): HistoryRecord[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return records;
  }

  return records.filter((record) =>
    [
      record.raw_text,
      record.processed_text ?? "",
      record.final_text,
      record.target_app,
      record.target_window_title
    ]
      .join("\n")
      .toLowerCase()
      .includes(normalized)
  );
}

export type HistoryFilterChip =
  | { id: "all"; kind: "all"; count: number }
  | { id: `mode:${CanonicalModeId}`; kind: "mode"; modeId: CanonicalModeId; count: number };

// Returns a fixed three-chip set: "All" plus the two canonical modes
// (Default / Translate) in their canonical order. Counts come from the
// records' processing_mode field; modes with zero records still render. Records
// whose processing_mode is non-canonical contribute only to the "All" count.
export function historyFilterChips(records: HistoryRecord[]): HistoryFilterChip[] {
  const counts: Record<CanonicalModeId, number> = { default: 0, translate: 0 };
  for (const record of records) {
    if (isCanonicalModeId(record.processing_mode)) {
      counts[record.processing_mode] += 1;
    }
  }
  return [
    { id: "all", kind: "all", count: records.length },
    ...CANONICAL_MODE_IDS.map(
      (modeId): HistoryFilterChip => ({
        id: `mode:${modeId}`,
        kind: "mode",
        modeId,
        count: counts[modeId]
      })
    )
  ];
}

export function historyMatchesFilter(record: HistoryRecord, filterId: string): boolean {
  if (!filterId || filterId === "all") return true;
  const [kind, value] = filterId.split(":", 2);
  if (kind === "mode") return record.processing_mode === value;
  return true;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
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

export function dayBucketLabel(record: HistoryRecord, now: Date): DayBucketLabel {
  const time = Date.parse(record.created_at);
  if (!Number.isFinite(time)) {
    return { primaryKind: "unknown", primaryMonth: null, primaryDay: null, date: "" };
  }
  const recordDate = new Date(time);
  const recordDay = new Date(
    recordDate.getFullYear(),
    recordDate.getMonth(),
    recordDate.getDate()
  );
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((today.getTime() - recordDay.getTime()) / (24 * 60 * 60 * 1000));
  const month = pad2(recordDate.getMonth() + 1);
  const day = pad2(recordDate.getDate());
  const monthAbbr = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const date = `${monthAbbr[recordDate.getMonth()]} ${day}`;
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

function timeOfDayWithSeconds(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "—";
  const date = new Date(time);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function clockDurationLabel(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${pad2(seconds)}`;
}

function polishedTextOf(record: HistoryRecord): string {
  return record.final_text || record.processed_text || record.raw_text || "";
}

function rawTextOf(record: HistoryRecord): string | null {
  const polished = polishedTextOf(record);
  if (!record.raw_text || record.raw_text === polished) return null;
  return record.raw_text;
}

export function historyDesignGroups(
  records: HistoryRecord[],
  now: Date,
  filterId: string,
  query: string
): HistoryDesignGroup[] {
  const filtered = filterHistoryRecords(records, query).filter((record) =>
    historyMatchesFilter(record, filterId)
  );
  const ordered = [...filtered].sort((left, right) =>
    right.created_at.localeCompare(left.created_at)
  );
  const groups = new Map<string, HistoryDesignGroup>();
  for (const record of ordered) {
    const labels = dayBucketLabel(record, now);
    const key = `${labels.primaryKind}|${labels.primaryMonth ?? ""}|${labels.primaryDay ?? ""}|${labels.date}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        primaryKind: labels.primaryKind,
        primaryMonth: labels.primaryMonth,
        primaryDay: labels.primaryDay,
        date: labels.date,
        rows: []
      };
      groups.set(key, group);
    }
    group.rows.push({
      id: record.id,
      time: timeOfDayWithSeconds(record.created_at),
      duration: clockDurationLabel(record.speaking_duration_ms),
      chars: Math.max(0, record.char_count),
      mode: record.processing_mode || "—",
      polished: polishedTextOf(record),
      raw: rawTextOf(record),
      status: record.status
    });
  }
  return Array.from(groups.values());
}

export async function listHistory(): Promise<HistoryRecord[]> {
  return invoke(HISTORY_COMMANDS.listHistory);
}

export async function deleteHistoryRecord(historyId: string): Promise<void> {
  return invoke(HISTORY_COMMANDS.deleteHistoryRecord, { historyId });
}

export async function clearHistory(): Promise<void> {
  return invoke(HISTORY_COMMANDS.clearHistory);
}
