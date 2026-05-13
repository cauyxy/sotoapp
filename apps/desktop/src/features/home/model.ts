export type HomeStatRecord = {
  created_at: string;
  char_count: number;
  speaking_duration_ms: number;
  processing_mode: string;
  final_text: string;
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

function timeOfDay(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "—";
  const date = new Date(time);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function recentBody(record: HomeStatRecord): string {
  return record.final_text || record.processed_text || record.raw_text || "";
}

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
    const time = Date.parse(record.created_at);
    if (!Number.isFinite(time) || time < startMs) continue;
    const chars = Math.max(0, record.char_count);
    const ms = Math.max(0, record.speaking_duration_ms);
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

export function recentTranscripts(
  history: readonly (HomeStatRecord & { id: string })[],
  limit = 3
): HomeRecentRow[] {
  const ordered = [...history].sort((left, right) =>
    right.created_at.localeCompare(left.created_at)
  );
  return ordered.slice(0, limit).map((record) => ({
    id: record.id,
    time: timeOfDay(record.created_at),
    mode: record.processing_mode || "—",
    chars: Math.max(0, record.char_count),
    body: recentBody(record)
  }));
}
