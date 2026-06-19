import { isValidHotwordCandidate } from "./hotwordFilter.js";
import type { LearningObservationEvent, LearningTerminalSignal } from "./pipeline.js";

export type EditDelta =
  | {
      kind: "unchanged";
      insertedText: "";
      removedText: "";
    }
  | {
      kind: "edited";
      insertedText: string;
      removedText: string;
    };

export interface EditDeltaInput {
  injectedText: string;
  observedText: string;
}

const REAL_TERMINAL_SIGNALS = new Set<LearningTerminalSignal>([
  "submit_key",
  "field_cleared",
  "focus_lost",
]);

const CANDIDATE_TOKEN = /[\p{L}\p{N}]+/gu;
const EAST_ASIAN_WORD_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

export function analyzeEditDelta(input: EditDeltaInput): EditDelta {
  const diff = diffTokens(input.injectedText, input.observedText);
  if (diff.inserted.length === 0 && diff.removed.length === 0) {
    return { kind: "unchanged", insertedText: "", removedText: "" };
  }
  return {
    kind: "edited",
    insertedText: diff.inserted.join(" "),
    removedText: diff.removed.join(" "),
  };
}

export function isLearningEventEligibleForAutoLearn(
  event: LearningObservationEvent,
): boolean {
  return (
    event.confidence === "high" && REAL_TERMINAL_SIGNALS.has(event.terminalSignal)
  );
}

export function hotwordCandidatesFromObservedEdit(
  event: LearningObservationEvent,
  existing: ReadonlySet<string>,
): string[] {
  if (!isLearningEventEligibleForAutoLearn(event)) return [];
  const diff = diffTokens(event.injectedText, event.observedText);
  const candidates: string[] = [];
  for (const term of diff.inserted) {
    if (hasUnsafeUnseparatedEastAsianOverlap(term, diff.removed)) continue;
    if (isValidHotwordCandidate(term, existing)) candidates.push(term);
  }
  return candidates;
}

function diffTokens(
  injectedText: string,
  observedText: string,
): { inserted: string[]; removed: string[] } {
  const injected = tokenTexts(injectedText);
  const observed = tokenTexts(observedText);

  const dp = Array.from({ length: injected.length + 1 }, () =>
    Array<number>(observed.length + 1).fill(0),
  );
  for (let i = injected.length - 1; i >= 0; i--) {
    for (let j = observed.length - 1; j >= 0; j--) {
      dp[i]![j] =
        injected[i] === observed[j]
          ? 1 + dp[i + 1]![j + 1]!
          : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  const inserted: string[] = [];
  const removed: string[] = [];
  let i = 0;
  let j = 0;
  while (i < injected.length || j < observed.length) {
    if (i < injected.length && j < observed.length && injected[i] === observed[j]) {
      i++;
      j++;
      continue;
    }
    if (
      i < injected.length &&
      (j >= observed.length || dp[i + 1]![j]! >= dp[i]![j + 1]!)
    ) {
      removed.push(injected[i]!);
      i++;
      continue;
    }
    if (j < observed.length) inserted.push(observed[j]!);
    j++;
  }
  return { inserted, removed };
}

function tokenTexts(text: string): string[] {
  return [...text.matchAll(CANDIDATE_TOKEN)].map((match) => match[0]);
}

function hasUnsafeUnseparatedEastAsianOverlap(
  term: string,
  removedTerms: readonly string[],
): boolean {
  if (!containsEastAsianWordScript(term)) return false;
  return removedTerms.some(
    (removed) =>
      containsEastAsianWordScript(removed) &&
      (commonPrefixLength(term, removed) > 0 ||
        commonSuffixLength(term, removed) > 0),
  );
}

function containsEastAsianWordScript(term: string): boolean {
  return EAST_ASIAN_WORD_SCRIPT.test(term);
}

function commonPrefixLength(a: string, b: string): number {
  const aa = [...a];
  const bb = [...b];
  let count = 0;
  while (count < aa.length && count < bb.length && aa[count] === bb[count]) {
    count++;
  }
  return count;
}

function commonSuffixLength(a: string, b: string): number {
  const aa = [...a];
  const bb = [...b];
  let count = 0;
  while (
    count < aa.length &&
    count < bb.length &&
    aa[aa.length - 1 - count] === bb[bb.length - 1 - count]
  ) {
    count++;
  }
  return count;
}
