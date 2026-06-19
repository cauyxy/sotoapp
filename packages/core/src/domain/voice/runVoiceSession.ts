// Pure-TS voice-session orchestrator. A single function whose every IO
// touchpoint is an injected port. The body is otherwise pure: pre-flight
// gates, status classification, focus comparison and HistoryRecord assembly
// are all decided here without touching the outside world.
//
// Reuses the existing @soto/core kernels: validateRecording (the
// too_short/silent gate), readActiveHotwords (hotword resolution), the
// ModelInputAssembler / ModelRuntime seam, sessionStatusFor (status
// classification), and the
// InjectionOutcome/HistoryRecord/AxContext schema types.

import type {
  AppInfo,
  AxContext,
  DictionaryEntry,
  HistoryRecord,
  InjectionOutcome,
  SessionStatus,
} from "../../contract/schema.js";
import { readActiveHotwords } from "../../capabilities/prompts/voicePrompt.js";
import {
  type AppContext,
  type TargetContextSnapshot,
} from "../../capabilities/context/context.js";
import {
  DefaultModelInputAssembler,
  type ModelInputAssembler,
} from "../../capabilities/model-input/assembler.js";
import type { ModelRuntime } from "../../capabilities/model-runtime/runtime.js";
import type { PostInsertObserver } from "../../capabilities/observation/postInsertObserver.js";
import { historyRecordForVoiceSession } from "./historyRecord.js";
import { validateRecording, type EmptyReason } from "./recordingValidator.js";
import { sessionStatusFor } from "../injection/outcome.js";

export type { AppInfo } from "../../contract/schema.js";
export { selectedTextOf } from "./targetSnapshot.js";

/** Why a session produced no usable text: the recording gates, or no speech. */
export type SessionEmptyReason = EmptyReason | "no_recognition";

/** Recording handed to the orchestrator after capture (already encoded). */
export interface CapturedRecording {
  /** Base64 audio payload forwarded to the model runtime. */
  audioB64: string;
  /** Container/codec hint forwarded to the model runtime. */
  audioFormat: string;
  durationMs: number;
  peak: number;
  voicedMs: number;
}

/** Target metadata for the active editor (stored on the history record). */
export interface SessionTarget {
  app: string | null;
  windowTitle: string | null;
  controlType: string | null;
}

// --- Injected ports -------------------------------------------------------

/**
 * Text injection (native insert / atomic paste) behind one call. Focus
 * protection lives HERE, matching Rust's RuntimePlatformInjector/AtomicPaste:
 * the adapter compares the current frontmost app against `savedApp`, attempts
 * activate + recheck, and returns a `focus_lost` InjectionOutcome only if the
 * target is genuinely gone. The orchestrator does not re-derive focus loss.
 */
export interface Injector {
  inject(
    text: string,
    savedApp: AppInfo | null,
    target: SessionTarget,
    options?: VoiceSessionInjectionOptions,
  ): Promise<InjectionOutcome>;
}

export interface VoiceSessionInjectionOptions {
  modeId: string;
  /** Lower-level insertion planner flag for atomic replacement-style delivery. */
  command: boolean;
}

export interface VoiceSessionInjectionPrepared {
  modeId: string;
  rawText: string;
  processedText: string | null;
  finalText: string;
  savedApp: AppInfo | null;
  target: SessionTarget;
  command: boolean;
}

/** History persistence sink. */
export interface HistorySink {
  append(record: HistoryRecord): Promise<void>;
}

/** Dictionary read used to assemble the hotword list. */
export interface DictionaryReader {
  readDictionary(): Promise<readonly DictionaryEntry[]>;
}

export interface VoiceSessionDeps {
  modelRuntime: ModelRuntime;
  injector: Injector;
  /**
   * Optional lifecycle hook after final text exists but before native insertion.
   * Main uses this to pay the visible thinking floor and announce insertion
   * without making @soto/core depend on Electron or renderer state.
   */
  beforeInject?: (prepared: VoiceSessionInjectionPrepared) => Promise<void>;
  history: HistorySink;
  dictionary: DictionaryReader;
  /**
   * Optional post-insert observer. It is started only after history.append()
   * succeeds, and the session does not wait for later observation results.
   */
  postInsertObserver?: PostInsertObserver;
  /** Observer timeout budget; defaults to the native-observer design ceiling. */
  postInsertObservationTimeoutMs?: number;
  /** Unix-ms clock (for record timestamps + hotword scoring). */
  now: () => number;
  /** UUID generator (record id suffix). */
  uuid: () => string;
  historyEnabled: boolean;
  modelInputAssembler?: ModelInputAssembler;
}

export interface VoiceSessionInput {
  /** Runtime session id from the main controller, used to correlate observation. */
  sessionId?: string;
  modeId: string;
  modePrompt: string;
  recording: CapturedRecording;
  /** Frontmost app captured at session start (null if capture failed). */
  savedApp: AppInfo | null;
  axContextAtStart: AxContext | null;
  target: SessionTarget;
  appContext: AppContext;
  snapshot: TargetContextSnapshot;
}

export interface SessionRunOutcome {
  historyId: string;
  rawText: string;
  processedText: string | null;
  finalText: string;
  status: SessionStatus;
  injectionOutcome: InjectionOutcome;
  emptyReason: SessionEmptyReason | null;
}

const NO_OP: InjectionOutcome = { kind: "no_op" };
const SHORT_SINGLE_LINE_LIMIT = 80;

function postprocessFinalText(text: string): string {
  if (text.includes("\n") || text.includes("\r")) return text;
  if ([...text].length >= SHORT_SINGLE_LINE_LIMIT) return text;
  if (!text.endsWith("。")) return text;
  return text.slice(0, -"。".length);
}

/** Pure short-circuit outcome for a session that produced no usable audio/text. */
function emptyOutcome(reason: SessionEmptyReason): SessionRunOutcome {
  return {
    historyId: "",
    rawText: "",
    processedText: null,
    finalText: "",
    status: "empty",
    injectionOutcome: NO_OP,
    emptyReason: reason,
  };
}

/**
 * Pure focus comparison. Native no-app/error sentinels never match. With bundle
 * ids on both sides, compare those; otherwise fall back to pid equality.
 */
export function isSameApp(a: AppInfo, b: AppInfo): boolean {
  if (a.pid <= 0 || b.pid <= 0) return false;
  if (a.bundleId !== undefined && b.bundleId !== undefined) {
    return a.bundleId === b.bundleId;
  }
  return a.pid === b.pid;
}

/**
 * Run a finished recording through the full session pipeline. Pure control
 * flow over injected ports: gate -> prompt -> transcribe -> classify ->
 * focus-protect -> inject -> assemble + append history -> outcome.
 *
 * Provider/transcription failures reject (the caller maps them to AppError).
 */
export async function runVoiceSession(
  deps: VoiceSessionDeps,
  input: VoiceSessionInput,
): Promise<SessionRunOutcome> {
  const { recording } = input;

  // Phase 1 — pre-flight gates (PURE).
  const gate = validateRecording(
    { durationMs: recording.durationMs, peak: recording.peak, voicedMs: recording.voicedMs },
    { allowSilent: false },
  );
  if (!gate.accepted) {
    return emptyOutcome(gate.reason);
  }

  // Phase 2 — gather model ingredients (IO: one dictionary read). Prompt
  // compilation remains engine-specific below ModelRuntime.
  const entries = await deps.dictionary.readDictionary();
  const modelNow = deps.now();
  const hotwords = readActiveHotwords(entries, modelNow);
  const modelInput = (deps.modelInputAssembler ?? DefaultModelInputAssembler).assemble({
    intent: "dictation",
    modeId: input.modeId,
    modePrompt: input.modePrompt,
    recording,
    appContext: input.appContext,
    hotwords,
    now: modelNow,
  });

  // Phase 3 — model runtime call (async IO). Errors propagate to the caller.
  const response = await deps.modelRuntime.respond(modelInput);

  // Phase 4 — finalize. Dictation short-circuits on empty recognition.
  const rawText = response.rawText.trim();
  const finalText = postprocessFinalText(response.finalText.trim());
  if (rawText === "") {
    return emptyOutcome("no_recognition");
  }
  const processedText = finalText === rawText ? null : finalText;

  await deps.beforeInject?.({
    modeId: input.modeId,
    rawText,
    processedText,
    finalText,
    savedApp: input.savedApp,
    target: input.target,
    command: false,
  });

  // Inject. Focus protection lives inside the injector port.
  const injectionOutcome = await deps.injector.inject(
    finalText,
    input.savedApp,
    input.target,
    { modeId: input.modeId, command: false },
  );

  // Status classification (PURE).
  const status = sessionStatusFor(rawText, injectionOutcome);

  // History record assembly (PURE).
  const record = historyRecordForVoiceSession({
    id: `history.${deps.uuid()}`,
    createdAt: deps.now(),
    modeId: input.modeId,
    recordingDurationMs: recording.durationMs,
    rawText,
    processedText,
    finalText,
    status,
    injectionOutcome,
    savedApp: input.savedApp,
    target: input.target,
    appContext: input.appContext,
    providerTrace: response.providerTrace,
  });

  if (deps.historyEnabled) {
    await deps.history.append(record);
    startPostInsertObservation(deps, input, record, input.snapshot);
  }

  return {
    historyId: record.id,
    rawText: record.raw_text,
    processedText: record.processed_text,
    finalText: record.injected_text ?? "",
    status: record.status,
    injectionOutcome: record.injection_outcome,
    emptyReason: null,
  };
}

function startPostInsertObservation(
  deps: VoiceSessionDeps,
  input: VoiceSessionInput,
  record: HistoryRecord,
  target: TargetContextSnapshot,
): void {
  const observer = deps.postInsertObserver;
  if (observer === undefined) return;
  try {
    observer.start({
      historyId: record.id,
      sessionId: input.sessionId ?? record.id,
      target: { ...target, reason: "post_insert_observation" },
      injectedText: record.injected_text ?? "",
      injectionOutcome: record.injection_outcome,
      startedAt: Number(record.created_at),
      timeoutMs: deps.postInsertObservationTimeoutMs ?? 45_000,
      onObservation: () => {},
    });
  } catch {
    // Observation is best-effort and must never change the session outcome.
  }
}
