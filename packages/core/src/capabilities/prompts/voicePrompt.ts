// Prompt assembly for omni audio and ASR+LLM text polish. The system prompt is
// only the stable instruction body; request-specific hotwords and context live in
// the user prompt so provider logs/debugging can separate policy from evidence.

import type { AxContext, DictionaryEntry } from "../../contract/schema.js";
import type { AppProfile } from "../context/appProfile.js";
import { withDerivedWebDomain } from "../context/signals.js";

export interface VoicePrompt {
  systemPrompt: string;
  userPrompt: string;
}

export interface HotwordBudget {
  maxTerms: number;
  maxTokensEst: number;
}

export const DEFAULT_HOTWORD_BUDGET: HotwordBudget = {
  maxTerms: 100,
  maxTokensEst: 500,
};

const FALLBACK_PROMPT = "Respond to the following audio.";
const USER_PROMPT = "请将这段语音转写并整理后输出";

function hotwordBlock(hotwords: readonly string[]): string {
  return `<热词>\n${hotwords.join("、")}\n</热词>`;
}

export interface VoicePromptOptions {
  appProfile?: AppProfile;
}

function nonEmpty(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.trim().length > 0 ? value : null;
}

function appLabel(axContext: AxContext, includeWindowContext: boolean): string | null {
  const bundleId = nonEmpty(axContext.app_bundle_id);
  if (!includeWindowContext) return bundleId ?? "unknown";

  const appName = nonEmpty(axContext.app_name);
  if (appName !== null && bundleId !== null) return `${appName}（${bundleId}）`;
  return appName ?? bundleId;
}

function axContextBlock(
  axContext: AxContext,
  includeWindowContext: boolean,
): string | null {
  const ctx = withDerivedWebDomain(axContext);
  const rows: string[] = [];
  const app = appLabel(ctx, includeWindowContext);
  if (app !== null) rows.push(`应用：${app}`);

  if (includeWindowContext) {
    const windowTitle = nonEmpty(ctx.window_title);
    const webDomain = nonEmpty(ctx.web_domain);
    const role = nonEmpty(ctx.ax_role);
    if (windowTitle !== null) rows.push(`窗口：${windowTitle}`);
    if (webDomain !== null) rows.push(`网页：${webDomain}`);
    if (role !== null) rows.push(`输入框类型：${role}`);
  }

  const before = nonEmpty(ctx.before);
  const after = nonEmpty(ctx.after);
  if (before !== null) rows.push(`光标前：${before}`);
  if (after !== null) rows.push(`光标后：${after}`);
  if (rows.length === 0) return null;

  return `<当前输入框上下文>\n${rows.join("\n")}\n</当前输入框上下文>`;
}

function appProfileBlock(profile: AppProfile | undefined): string | null {
  if (profile === undefined) return null;
  const rows: string[] = [];
  if (profile.registerHint !== undefined) rows.push(`语体：${profile.registerHint}`);
  if (profile.punctuationStyle !== undefined) rows.push(`标点：${profile.punctuationStyle}`);
  if (profile.structuredBias !== undefined) rows.push(`结构化：${profile.structuredBias}`);
  if (rows.length === 0) return null;
  return `<应用后处理>\n${rows.join("\n")}\n</应用后处理>`;
}

function joinPromptParts(parts: readonly (string | null)[]): string {
  return parts.filter((part): part is string => part !== null).join("\n\n");
}

/**
 * Assemble the voice prompt from a (already-resolved) hotword list. The system
 * prompt is the stable mode instruction only. The user prompt carries the task,
 * hotword block, app-profile hints, and optional AX-context block.
 */
export function buildVoicePrompt(
  modePrompt: string,
  hotwords: readonly string[],
  axContext: AxContext | null,
  options: VoicePromptOptions = {},
): VoicePrompt {
  const systemBody =
    modePrompt.trim().length === 0 ? FALLBACK_PROMPT : modePrompt;

  const userPrompt = buildUserPromptWithContext(
    USER_PROMPT,
    hotwords,
    axContext,
    options,
  );

  return { systemPrompt: systemBody, userPrompt };
}

/**
 * Text-polish frame for the ASR + LLM engine (engine spec §5): the system prompt
 * is exactly the mode instruction. The user message carries the raw ASR
 * transcript plus hotwords and optional context.
 */
export function buildPolishPrompt(
  modePrompt: string,
  hotwords: readonly string[],
  axContext: AxContext | null,
  transcript: string,
  options: VoicePromptOptions = {},
): VoicePrompt {
  const userPrompt = buildUserPromptWithContext(
    rawTranscriptBlock(transcript),
    hotwords,
    axContext,
    options,
  );
  return { systemPrompt: modePrompt, userPrompt };
}

function buildUserPromptWithContext(
  primary: string,
  hotwords: readonly string[],
  axContext: AxContext | null,
  options: VoicePromptOptions,
): string {
  const profileBlock = appProfileBlock(options.appProfile);
  const contextBlock =
    axContext === null ? null : axContextBlock(axContext, true);
  return joinPromptParts([
    primary,
    profileBlock,
    hotwordBlock(hotwords),
    contextBlock,
  ]);
}

function rawTranscriptBlock(transcript: string): string {
  return `<原始转写>\n${transcript}\n</原始转写>`;
}

/** Recency-weighted relevance score for an auto-learned dictionary entry. */
export function score(entry: DictionaryEntry, now: number): number {
  const hit = Math.log1p(entry.hit_count);
  let recency: number;
  if (entry.last_used_at === null) {
    recency = 0.5;
  } else {
    const days = (now - Number(entry.last_used_at)) / 86_400_000;
    recency = Math.exp(-days / 30);
  }
  return hit * 0.6 + recency * 0.4;
}

/**
 * Resolve the active hotword list from stored dictionary entries: every
 * user-added term first, then the highest-scoring auto-learned terms that fit
 * the remaining term budget. There is no preset layer; an empty dictionary
 * yields an empty list.
 */
export function readActiveHotwords(
  entries: readonly DictionaryEntry[],
  now: number,
  budget: HotwordBudget = DEFAULT_HOTWORD_BUDGET,
): string[] {
  const out: string[] = [];

  for (const entry of entries) {
    if (entry.source === "user_added") out.push(entry.term);
  }

  const remaining = Math.max(0, budget.maxTerms - out.length);
  if (remaining > 0) {
    const autoLearned = entries
      .filter((entry) => entry.source === "auto_learned")
      .map((entry) => ({ entry, s: score(entry, now) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, remaining);
    for (const { entry } of autoLearned) out.push(entry.term);
  }

  return out;
}
