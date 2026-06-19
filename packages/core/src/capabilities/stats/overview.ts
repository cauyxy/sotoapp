// Home-page usage statistics — pure, deterministic derivation over dictation
// history. Moved here from apps/desktop/src/renderer/pages/home/model.ts so the
// date-bucketing + stats arithmetic lives alongside the other framework-free
// capabilities and is unit-tested in Node. Data-in/data-out: no React, no IO.
//
// HomeStatRecord is a structural subset of the contract-layer HistoryRecord —
// only the fields these functions read are required, so the renderer can pass
// full HistoryRecord values without conversion.

import { timeOfDayLabel } from "../../foundation/time/format.js";
import { polishedTranscriptText } from "../history/derive.js";

export type HomeStatRecord = {
  id: string;
  created_at: bigint;
  char_count: number;
  speaking_duration_ms: bigint;
  mode_id: string | null;
  injected_text: string | null;
  processed_text: string | null;
  raw_text: string;
  status: string;
};

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export const TYPING_CPM = 50;
export const MIN_SPEAKING_MS_FOR_CPM = 500;

export type HomeRecentRow = {
  id: string;
  time: string;
  mode: string;
  chars: number;
  body: string;
};

export type HomeOverview = {
  speakMinutes: number;
  characterCount: number;
  savedMinutes: number;
  avgCpm: number | null;
};

export function weeklyOverview(
  history: readonly HomeStatRecord[],
  now: Date = new Date()
): HomeOverview {
  const today = startOfDay(now);
  const startMs = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - 6
  ).getTime();

  let characterCount = 0;
  let speakingMs = 0;
  let cpmSum = 0;
  let cpmCount = 0;
  for (const record of history) {
    const time = Number(record.created_at);
    if (!Number.isFinite(time) || time < startMs) continue;
    const chars = Math.max(0, record.char_count);
    const ms = Math.max(0, Number(record.speaking_duration_ms));
    characterCount += chars;
    speakingMs += ms;
    if (chars > 0 && ms >= MIN_SPEAKING_MS_FOR_CPM) {
      cpmSum += chars / (ms / 60000);
      cpmCount += 1;
    }
  }

  const speakMinutes = Math.round(speakingMs / 60000);
  const typingMinutes = characterCount / TYPING_CPM;
  const savedMinutes = Math.max(0, Math.round(typingMinutes - speakingMs / 60000));
  const avgCpm = cpmCount === 0 ? null : Math.round(cpmSum / cpmCount);
  return { speakMinutes, characterCount, savedMinutes, avgCpm };
}

export interface TodayOverview {
  characterCount: number;
  sessionCount: number;
  avgSeconds: number;
}

/** Today's inline status-row stats (visual spec §2.8): characters, session
 * count, and average speaking seconds for the local calendar day. */
export function todayOverview(records: readonly HomeStatRecord[], now: number): TodayOverview {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  const start = day.getTime();
  const today = records.filter(
    (r) => r.status === "completed" && Number(r.created_at) >= start && Number(r.created_at) <= now,
  );
  const characterCount = today.reduce((sum, r) => sum + r.char_count, 0);
  const totalMs = today.reduce((sum, r) => sum + Number(r.speaking_duration_ms), 0);
  return {
    characterCount,
    sessionCount: today.length,
    avgSeconds: today.length === 0 ? 0 : totalMs / today.length / 1000,
  };
}

export function recentTranscripts(
  history: readonly HomeStatRecord[],
  limit = 3
): HomeRecentRow[] {
  const ordered = [...history].sort((left, right) => {
    return Number(right.created_at) - Number(left.created_at);
  });
  return ordered.slice(0, limit).map((record) => ({
    id: record.id,
    time: timeOfDayLabel(record.created_at),
    mode: record.mode_id || "—",
    chars: Math.max(0, record.char_count),
    body: polishedTranscriptText(record)
  }));
}
