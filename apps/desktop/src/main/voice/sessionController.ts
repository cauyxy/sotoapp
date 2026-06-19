// SessionController — the keystone that connects the tested pieces into a live
// recording flow, adapted to the Electron split where the microphone lives in
// the renderer:
//
//   hotkey toggle (HotkeyRuntime -> HotkeyRuntimeAction)
//     -> start_recording  : start target-context capture, tell the renderer to
//                            begin capture, emit `started` (listening)
//     -> finish_recording : emit `thinking`, ask the renderer for the WAV; when
//                            it arrives (push_capture_audio) run runVoiceSession
//                            and emit `completed`/`failed`; model runtime errors
//                            -> `error`
//     -> cancel_recording : tell the renderer to cancel capture, emit `cancelled`
//
// Every IO touchpoint is an injected port so the toggle/dispatch logic is unit-
// testable with fakes. The only runtime-only seams are the two emit callbacks
// (webContents.send) and the deps factory (which reads the store + builds the
// @soto/core voice-session ports); those are wired thinly in main/index.ts.
//
// runVoiceSession itself stays pure (@soto/core) — the controller hands it the
// CapturedRecording the renderer produced plus the deps the factory built.

import {
  RecordingSessionMachine,
  panelHideLingerMs,
  runVoiceSession,
  type AppInfo,
  type AxContext,
  type CaptureControlEvent,
  type FocusProbeStatus,
  type HotkeyRuntimeAction,
  type InjectionOutcome,
  type PanelNoticePrimaryAction,
  type SessionRunOutcome,
  type SessionStatus,
  type VoiceRuntimeErrorCode,
  type VoiceRuntimeEvent,
  type VoiceSessionDeps,
} from "@soto/core";
import {
  acquireTargetContext,
  type AcquiredContext,
} from "../context/acquireTargetContext.js";
import type { CapsuleExitIntent } from "../windows/capsuleOverlay.js";

/** Wire range for the `level` voice-runtime event (matches normalizeLevel). */
const RAW_LEVEL_MAX = 65535;
/** Window linger after a clean success: covers sprint→check→hold→exit (spec §4). */
const SUCCESS_LINGER_MS = 700;
/** Window linger after a cancel: immediate fast retraction. */
const CANCEL_LINGER_MS = 200;
/** Thinking-phase reassurance beats (spec §8.2). */
const SLOW_NOTICE_AT_MS = [8000, 20000] as const;
/**
 * Floor for the VISIBLE thinking phase. The JS progress curve reaches 84% at
 * 1.4s (thinkingProgressPct); a faster pipeline response used to replace a
 * half-drawn bar with the completion choreography — a flash. Terminal events
 * now wait out this floor (pipeline time overlaps the wait; cancel is exempt).
 */
const MIN_THINKING_DISPLAY_MS = 1400;

type MaybePromise<T> = T | Promise<T>;

/** A finished recording the renderer pushed for the active session. */
export interface CapturePush {
  sessionId: string;
  wavBase64: string;
  durationMs: number;
  /** Peak amplitude over the whole recording, [0,1] — feeds the silence gate. */
  peak: number;
  /** Detected speech duration over the final encoded PCM, in milliseconds. */
  voicedMs: number;
}

/**
 * What the controller needs to actually run a session, resolved lazily per
 * session start: the active mode's prompt + the @soto/core VoiceSessionDeps
 * (model runtime/injector/history/dictionary ports).
 */
export interface SessionContext {
  modePrompt: string;
  deps: VoiceSessionDeps;
  /** Optional main-process cleanup for per-session transports such as realtime sockets. */
  dispose?: () => void;
}

/**
 * Why a session could not be resolved. Surfaced as the matching voice-runtime
 * error code (the Panel shows a precise notice) instead of a silent fallback to
 * an arbitrary provider / empty prompt.
 */
export interface SessionResolveFailure {
  error: VoiceRuntimeErrorCode;
}

export interface SessionControllerPorts {
  /** Emit a voice-runtime event to the relevant windows (webContents.send). */
  emitVoiceRuntime(event: VoiceRuntimeEvent): void;
  /** Tell the renderer to begin/finish/cancel microphone capture. */
  sendCaptureControl(event: CaptureControlEvent): void;
  /**
   * Show/hide the capsule overlay. Show on a session start; hide on every
   * terminal outcome. `lingerMs` (hide only) overrides the default short hide
   * delay so the capsule window stays up long enough for a Panel notice to be
   * read (the Panel lives INSIDE this window) — see panelHideLingerMs. Omitted /
   * undefined → the default short hide, so a clean success disappears promptly.
   * The controller stays pure about WHEN; the index.ts port impl owns the HOW.
   */
  setCapsuleVisible(
    visible: boolean,
    lingerMs?: number,
    exit?: CapsuleExitIntent,
  ): void;
  /**
   * Mute/unmute background media for the recording window. Called `true` on a
   * real recording start and `false` on every terminal (finish/cancel/error).
   * The main impl routes this to the native MediaMuteCoordinator (save/restore +
   * no-stacking); the controller only decides WHEN. Best-effort — never blocks
   * or throws into the recording flow.
   */
  setMediaMuted(muted: boolean): void;
  /** Frontmost app at session start, for focus protection (null if unknown). */
  frontmostApp(): AppInfo | null;
  /** AX context at session start (null when untrusted/unavailable). */
  captureAxContext(): MaybePromise<AxContext | null>;
  /** Active window title at session start (null when unavailable). */
  captureWindowTitle?(): MaybePromise<string | null>;
  /** Focus trust probe at session start. */
  probeFocus(): MaybePromise<FocusProbeStatus>;
  /** Whether target app/window/web details may be included in model context. */
  includeWindowContextInRequests(): boolean;
  /** Display name of `modeId`, or null when unresolved. Sync store read. */
  modeName(modeId: string): string | null;
  /**
   * Resolve the active mode prompt + voice-session deps for a mode, or a typed
   * failure (missing provider / missing mode / runtime unavailable) — never a
   * silent fallback. Async so the factory may touch the store/secrets.
   */
  resolveSession(modeId: string): Promise<SessionContext | SessionResolveFailure>;
  /** UUID generator for session ids (and so tests are deterministic). */
  uuid(): string;
  /** Active mic device id, or null for system default (forwarded to renderer). */
  micDeviceId(): string | null;
  /**
   * True while a terminal notice is still visible (overlay hide pending or
   * hover-paused). Backed by CapsuleOverlay.hasPendingHide(); false during a
   * live recording, which schedules no hide.
   */
  isOverlayLingering(): boolean;
  /** Expedite-hide a lingering notice without starting a session (chord-dismiss). */
  expediteOverlayHide(): void;
  /**
   * A start gesture was CONSUMED as a notice dismissal (no session started).
   * The hotkey coordinator already toggled to active on the press, so the
   * caller must reset it (HotkeyRuntime.resetSession) or the next press would
   * read as `complete` and be silently dropped.
   */
  onStartConsumed?(): void;
  /** Copy the last terminal text for a Panel primary action. */
  copyNoticeText?(text: string): void;
  /** Open Accessibility settings for a permission Panel primary action. */
  openAccessibilitySettings?(): void;
  /** Test override for MIN_THINKING_DISPLAY_MS (0 disables the floor). */
  thinkingFloorMs?: number;
  /** Test override for platform-specific post-insertion UI settle timing. */
  insertionSettleMs?: (outcome: InjectionOutcome, finalText: string) => number;
  /** Optional log sink for the session lifecycle (the caller supplies the prefix). */
  log?(message: string): void;
  /** Cancel any active post-insert observer when a new user session starts. */
  cancelPostInsertObservation?(): void;
}

interface ActiveSession {
  sessionId: string;
  generation: number;
  modeId: string;
  targetContextPromise: Promise<AcquiredContext>;
  /** True once finish_recording fired and we are awaiting the renderer's WAV. */
  awaitingAudio: boolean;
  /** Display name of the running mode, or null when unresolved. */
  modeName: string | null;
}

type SessionDisplayPlan =
  | { lingerMs?: number; exit: CapsuleExitIntent }
  | "superseded";

/** Map a SessionRunOutcome onto the terminal voice-runtime event for its status. */
function terminalEventFor(outcome: SessionRunOutcome): VoiceRuntimeEvent {
  // completed/cancelled/failed share the result field shape; the `kind` follows
  // the session status. `empty` maps to `completed` (the capsule shows the empty
  // result + reason), matching the Rust outcome->event mapping where an empty
  // recording still produces a completion result the UI surfaces.
  const kind: Extract<
    VoiceRuntimeEvent,
    { kind: "completed" | "cancelled" | "failed" }
  >["kind"] =
    outcome.status === "cancelled"
      ? "cancelled"
      : outcome.status === "failed"
        ? "failed"
        : "completed";

  const base = {
    kind,
    history_id: outcome.historyId,
    raw_text: outcome.rawText,
    processed_text: outcome.processedText,
    final_text: outcome.finalText,
    status: outcome.status as SessionStatus,
    injection_outcome: outcome.injectionOutcome,
  };
  return outcome.emptyReason !== null
    ? { ...base, empty_reason: outcome.emptyReason }
    : base;
}

export class SessionController {
  // The recording FSM is recreated per session (it returns to idle by being
  // reconstructed, per the @soto/core port contract).
  private machine = new RecordingSessionMachine();
  private active: ActiveSession | null = null;
  private sessionGeneration = 0;
  private slowTimers: ReturnType<typeof setTimeout>[] = [];
  /** Wall-clock when the thinking phase began (0 = not thinking). */
  private thinkingStartedAt = 0;
  private lastTerminalText = "";
  /**
   * True after an error/failed terminal until the user sees/handles it: the
   * next chord press while its notice is still lingering DISMISSES the overlay
   * instead of starting a session (the keyboard otherwise has no way to make a
   * failure-loop notice go away — it would just reappear). Benign notices
   * (empty result / copied / no-selection) never set it, so rapid re-dictation
   * keeps its muscle memory.
   */
  private attentionNotice = false;

  /** Single emission seam: tracks which events demand acknowledgement. */
  private emit(event: VoiceRuntimeEvent): void {
    if ("final_text" in event && event.final_text.length > 0) {
      this.lastTerminalText = event.final_text;
    }
    if (event.kind === "error" || event.kind === "failed") {
      this.attentionNotice = true;
    } else if (event.kind === "started") {
      this.attentionNotice = false;
    }
    this.ports.emitVoiceRuntime(event);
  }

  constructor(private readonly ports: SessionControllerPorts) {}

  private currentRunDispose: (() => void) | null = null;

  /** Concise lifecycle log (no-op unless a log port is wired). */
  private log(message: string): void {
    this.ports.log?.(message);
  }

  private clearSlowTimers(): void {
    for (const t of this.slowTimers) clearTimeout(t);
    this.slowTimers = [];
  }

  private disposeCurrentRun(): void {
    const dispose = this.currentRunDispose;
    if (dispose === null) return;
    this.currentRunDispose = null;
    safe(() => dispose(), undefined);
  }

  private isSuperseded(active: ActiveSession): boolean {
    return (
      this.sessionGeneration !== active.generation ||
      (this.active !== null && this.active.sessionId !== active.sessionId)
    );
  }

  private captureTargetContext(): Promise<AcquiredContext> {
    return acquireTargetContext(
      {
        frontmostApp: () => this.ports.frontmostApp(),
        captureAxContext: () => this.ports.captureAxContext(),
        captureWindowTitle: () => this.ports.captureWindowTitle?.() ?? null,
        probeFocus: () => this.ports.probeFocus(),
        now: () => Date.now(),
        uuid: () => this.ports.uuid(),
        log: (message) => this.log(message),
      },
      "voice_session_start",
      { clipboardContextMode: "off" },
      safe(() => this.ports.includeWindowContextInRequests(), true),
    );
  }

  /** The mode id of the running session, if any (for diagnostics/tests). */
  activeModeId(): string | null {
    return this.active?.modeId ?? null;
  }

  /**
   * Drive the controller from a hotkey runtime action (start/finish/cancel).
   * Mirrors the Rust worker's handle_hotkey_action dispatch.
   */
  async dispatch(action: HotkeyRuntimeAction): Promise<void> {
    switch (action.kind) {
      case "start_recording":
        await this.startRecording(action.mode_id);
        return;
      case "finish_recording":
        this.finishRecording();
        return;
      case "cancel_recording":
        this.cancelRecording();
        return;
    }
  }

  private async startRecording(modeId: string): Promise<void> {
    // A start while a session is active is ignored (the coordinator upstream
    // already de-dupes same/other-mode presses; this is the worker-level guard).
    if (this.active !== null) return;
    this.disposeCurrentRun();
    this.ports.cancelPostInsertObservation?.();

    // Chord-dismiss: while an attention notice (error / failed) is still
    // lingering on screen, the press closes the overlay instead of recording —
    // otherwise a failure-loop notice (e.g. missing provider) just reappears
    // forever and the keyboard can never make it go away. Benign notices fall
    // through and record as always. The coordinator already toggled to active
    // on this press, so the consume must be reported (onStartConsumed → reset)
    // or the next press would read as `complete` and be dropped.
    if (this.attentionNotice) {
      if (this.ports.isOverlayLingering()) {
        this.attentionNotice = false;
        this.ports.expediteOverlayHide();
        this.ports.onStartConsumed?.();
        this.log(`chord dismissed lingering notice (mode=${modeId})`);
        return;
      }
      this.attentionNotice = false; // stale: overlay already hidden → record.
    }

    const sessionId = this.ports.uuid();
    const generation = this.sessionGeneration + 1;
    this.sessionGeneration = generation;
    const targetContextPromise = this.captureTargetContext();
    const modeName = safe(() => this.ports.modeName(modeId), null);

    this.ports.setCapsuleVisible(true);

    this.machine = new RecordingSessionMachine();
    this.machine.handle({ type: "hotkey_down", modeId, at: Date.now() });
    this.active = {
      sessionId,
      generation,
      modeId,
      targetContextPromise,
      awaitingAudio: false,
      modeName,
    };
    this.log(`recording start requested (mode=${modeId}, session=${short(sessionId)})`);
    void targetContextPromise
      .then((targetContext) => {
        const active = this.active;
        if (
          active === null ||
          active.sessionId !== sessionId ||
          active.generation !== generation
        ) {
          return;
        }
        this.log(focusStartForLog(modeId, sessionId, targetContext));
      })
      .catch((error) => {
        const active = this.active;
        if (
          active === null ||
          active.sessionId !== sessionId ||
          active.generation !== generation
        ) {
          return;
        }
        this.log(`target context capture failed (session=${short(sessionId)}): ${messageOf(error)}`);
      });

    this.ports.sendCaptureControl({
      kind: "begin",
      session_id: sessionId,
      mode_id: modeId,
      device_id: this.ports.micDeviceId(),
    });

    // `started` (listening) — the capsule reducer flips to "listening".
    this.emit({
      kind: "started",
      handle_id: sessionId,
      mode_id: modeId,
      status: "listening",
      mode_name: modeName,
    });
    this.log(`recording started (mode=${modeId}, session=${short(sessionId)})`);
  }

  private finishRecording(): void {
    const active = this.active;
    if (active === null) return;
    if (active.awaitingAudio) return;
    active.awaitingAudio = true;
    this.thinkingStartedAt = Date.now();
    this.machine.handle({ type: "hotkey_up", at: Date.now() });

    // `thinking` — the capsule shows the spinner while we await + transcribe.
    this.emit({
      kind: "thinking",
      handle_id: active.sessionId,
      mode_id: active.modeId,
      status: "thinking",
      mode_name: active.modeName,
    });
    // Tell the renderer to stop the mic + push the WAV. WITHOUT this the capsule
    // never stops capturing, no push_capture_audio arrives, onCaptureAudio never
    // runs, this.active stays set and every later hotkey press is dropped by the
    // startRecording guard — the confirmed "only the first recording works" hang.
    // The capsule ✓ button calls the same finishCapture() path, so button and
    // hotkey converge.
    this.ports.sendCaptureControl({ kind: "finish", session_id: active.sessionId });
    // Reassure during a long wait: push "still working" at 8s and escalate with
    // the Esc hint at 20s. Cleared on every terminal path.
    this.clearSlowTimers();
    for (const at of SLOW_NOTICE_AT_MS) {
      const t = setTimeout(() => {
        this.emit({
          kind: "slow",
          mode_id: active.modeId,
          elapsed_ms: at,
        });
      }, at);
      if (typeof t.unref === "function") t.unref();
      this.slowTimers.push(t);
    }
    // Recording stopped → restore background media now (the mic is closed, so the
    // silence-during-dictation window is over). Done here, BEFORE the renderer
    // plays the stop cue, so the cue is audible (mute and cues are decoupled).
    this.ports.setMediaMuted(false);
    // We do NOT run the session yet — we wait for the renderer to push the WAV
    // (onCaptureAudio). The renderer's capture stop() is what produces it.
    this.log(`recording stopped; awaiting audio (session=${short(active.sessionId)})`);
  }

  private cancelRecording(): void {
    const active = this.active;
    if (active === null) return;
    this.disposeCurrentRun();
    this.clearSlowTimers();
    this.thinkingStartedAt = 0; // a cancel is instant — no thinking floor
    this.machine.handle({ type: "escape" });
    this.ports.sendCaptureControl({ kind: "cancel", session_id: active.sessionId });
    this.emit({
      kind: "cancelled",
      history_id: "",
      raw_text: "",
      processed_text: null,
      final_text: "",
      status: "cancelled",
      injection_outcome: { kind: "no_op" },
    });
    this.ports.setMediaMuted(false);
    this.ports.setCapsuleVisible(false, CANCEL_LINGER_MS, "cancel");
    this.log(`recording cancelled (session=${short(active.sessionId)})`);
    this.active = null;
  }

  /**
   * Finish the active session from the capsule ✓ button's
   * finish_active_voice_runtime command (the button-driven analogue of a
   * finish_recording hotkey toggle). No-op when no session is active.
   */
  finishActive(): void {
    this.finishRecording();
  }

  /**
   * Cancel the active session from the capsule ✕ button's
   * cancel_active_voice_runtime command (the button-driven analogue of a
   * cancel_recording hotkey toggle). No-op when no session is active.
   */
  cancelActive(): void {
    this.cancelRecording();
  }

  /**
   * The user dismissed the notice themselves (Got it / strip click). Clears
   * the attention flag so a later chord press records instead of consuming
   * against an already-dismissed notice.
   */
  noticeDismissed(): void {
    this.attentionNotice = false;
  }

  noticeAction(id: PanelNoticePrimaryAction["id"]): void {
    if (id === "copy_text") {
      if (this.lastTerminalText.length > 0) {
        this.ports.copyNoticeText?.(this.lastTerminalText);
      }
      return;
    }
    this.ports.openAccessibilitySettings?.();
  }

  /** Renderer ack that capture began (informational; correlates the session). */
  onCaptureStarted(sessionId: string): void {
    // The renderer acks that the mic truly opened (sent after the start cue's
    // lead). This is the real "recording started" edge, so mute background media
    // now. Guard against a stale/finished session so a late ack cannot re-mute
    // after we already restored — e.g. an ultra-short press that finished during
    // the cue lead: only engage while this session is still actively listening.
    if (
      this.active === null ||
      this.active.sessionId !== sessionId ||
      this.active.awaitingAudio
    ) {
      return;
    }
    this.ports.setMediaMuted(true);
  }

  /** Renderer streamed a meter sample (0..1); relay as a `level` event. */
  onCaptureLevel(sessionId: string, level: number): void {
    if (this.active === null || this.active.sessionId !== sessionId) return;
    const scaled = Math.max(0, Math.min(RAW_LEVEL_MAX, Math.round(level * RAW_LEVEL_MAX)));
    this.emit({ kind: "level", rms: scaled, peak: scaled });
  }

  /** Renderer reported a capture failure (e.g. mic denied) for the session. */
  async onCaptureError(sessionId: string, message: string): Promise<void> {
    const active = this.active;
    if (active === null || active.sessionId !== sessionId) return;
    this.disposeCurrentRun();
    this.clearSlowTimers();
    this.machine.handle({ type: "recording_error", message });
    // Release the renderer's mic + restore media IMMEDIATELY — hardware
    // concerns never wait for display choreography. The renderer's
    // cancelCapture is idempotent, so this is safe even when the error came
    // from the renderer itself (mic already torn down). Clearing the active
    // slot now lets a fresh session start during the floor wait below.
    this.ports.sendCaptureControl({ kind: "cancel", session_id: sessionId });
    this.ports.setMediaMuted(false);
    this.active = null;

    const errorEvent: VoiceRuntimeEvent = { kind: "error", code: "generic", message };
    const display = await this.emitTerminalAfterFloor(errorEvent, active);
    this.log(`capture error (session=${short(sessionId)}): ${message}`);
    if (display !== "superseded") {
      // Keep the capsule window up long enough for the error Panel to be read.
      this.ports.setCapsuleVisible(false, display.lingerMs, display.exit);
    }
  }

  /**
   * Renderer pushed the finished recording. Runs the full @soto/core session
   * pipeline through the resolved deps and emits the terminal event. A late
   * push for a non-active / non-matching session is dropped.
   */
  async onCaptureAudio(push: CapturePush): Promise<void> {
    const active = this.active;
    if (active === null || active.sessionId !== push.sessionId) return;
    this.clearSlowTimers();
    // Clear the active slot up front so a duplicate push can't double-run.
    this.active = null;
    this.log(
      `audio received: ${push.durationMs}ms peak=${push.peak.toFixed(3)} voiced=${push.voicedMs}ms ` +
        `(session=${short(push.sessionId)})`,
    );

    // Every path below is terminal (emits a terminal/error event and returns),
    // so the capsule is hidden once in a `finally`. The hide-delay that keeps a
    // completed result briefly visible is the index.ts port impl's job.
    let display: SessionDisplayPlan | undefined;
    try {
      display = await this.runResolvedSession(active, push);
    } finally {
      // Safety net: the coordinator's unmute is idempotent, so restoring here
      // too guarantees media is never left muted even if finishRecording's
      // unmute was somehow skipped on a particular finish path.
      this.ports.setMediaMuted(false);
      // Notice-bearing terminals linger for their notice (+ exit margin, from
      // core); a clean success gets the 700ms completion choreography. A
      // superseded terminal (a new session started during the thinking floor)
      // must NOT schedule a hide — it would hide the new session's window.
      if (display !== "superseded") {
        this.ports.setCapsuleVisible(
          false,
          display?.lingerMs ?? SUCCESS_LINGER_MS,
          display?.exit ?? "default",
        );
      }
    }
  }

  /**
   * Wait out the remainder of the thinking-display floor: the renderer's
   * progress band needs ~1.1s to visibly reach its 84% park; completing the
   * UI any earlier flashes a half-drawn bar. Pipeline time overlaps the wait
   * (the floor counts from finishRecording). No-op when not thinking.
   */
  private async settleThinkingFloor(): Promise<void> {
    const startedAt = this.thinkingStartedAt;
    this.thinkingStartedAt = 0;
    if (startedAt === 0) return;
    const floor = this.ports.thinkingFloorMs ?? MIN_THINKING_DISPLAY_MS;
    const remaining = floor - (Date.now() - startedAt);
    if (remaining <= 0) return;
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, remaining);
      if (typeof t.unref === "function") t.unref();
    });
  }

  /**
   * Emit a terminal/error event after the thinking floor has elapsed. Returns
   * the hide choreography plan, or "superseded"
   * when a NEW session started during the wait — the stale event is then
   * suppressed (it would overwrite the new session's capsule face) and the
   * caller must not schedule a window hide.
   */
  private async emitTerminalAfterFloor(
    event: VoiceRuntimeEvent,
    active?: ActiveSession,
  ): Promise<SessionDisplayPlan> {
    if (active !== undefined && this.isSuperseded(active)) {
      this.log("terminal superseded by a newer session; stale UI event suppressed");
      return "superseded";
    }
    await this.settleThinkingFloor();
    if (active !== undefined ? this.isSuperseded(active) : this.active !== null) {
      this.log("terminal superseded by a newer session; stale UI event suppressed");
      return "superseded";
    }
    this.emit(event);
    return { lingerMs: panelHideLingerMs(event) ?? undefined, exit: exitIntentForEvent(event) };
  }

  /**
   * Pay the visible thinking floor before native insertion, then announce the
   * insertion phase. If a newer recording started during the wait, suppress the
   * stale run before it can inject text into the target app.
   */
  private async emitInsertingAfterFloor(active: ActiveSession): Promise<"continue" | "superseded"> {
    if (this.isSuperseded(active)) {
      this.log("insertion superseded by a newer session; stale injection suppressed");
      return "superseded";
    }
    await this.settleThinkingFloor();
    if (this.isSuperseded(active)) {
      this.log("insertion superseded by a newer session; stale injection suppressed");
      return "superseded";
    }
    this.emit({
      kind: "inserting",
      handle_id: active.sessionId,
      mode_id: active.modeId,
      status: "inserting",
      mode_name: active.modeName,
    });
    return "continue";
  }

  private async settleInsertion(outcome: SessionRunOutcome): Promise<void> {
    const settleMs = Math.max(
      0,
      this.ports.insertionSettleMs?.(outcome.injectionOutcome, outcome.finalText) ?? 0,
    );
    if (settleMs <= 0) return;
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, settleMs);
      if (typeof t.unref === "function") t.unref();
    });
  }

  /** Resolve deps + run the pipeline + emit the terminal event for a push. */
  private async runResolvedSession(
    active: ActiveSession,
    push: CapturePush,
  ): Promise<SessionDisplayPlan> {
    let targetContext: AcquiredContext;
    try {
      targetContext = await active.targetContextPromise;
    } catch (error) {
      if (this.isSuperseded(active)) {
        this.log("target context superseded by a newer session; stale session suppressed");
        return "superseded";
      }
      const ev: VoiceRuntimeEvent = {
        kind: "error",
        code: "generic",
        message: `failed to capture target context: ${messageOf(error)}`,
      };
      this.log(`session error: failed to capture target context: ${messageOf(error)}`);
      return this.emitTerminalAfterFloor(ev, active);
    }
    if (this.isSuperseded(active)) {
      this.log("target context superseded by a newer session; stale session suppressed");
      return "superseded";
    }
    let resolved: SessionContext | SessionResolveFailure;
    try {
      resolved = await this.ports.resolveSession(active.modeId);
    } catch (error) {
      const ev: VoiceRuntimeEvent = {
        kind: "error",
        code: "generic",
        message: `failed to resolve session: ${messageOf(error)}`,
      };
      this.log(`session error: failed to resolve session: ${messageOf(error)}`);
      return this.emitTerminalAfterFloor(ev, active);
    }
    if ("error" in resolved) {
      // Not configured enough to run — surface the precise reason rather than a
      // silent fallback (missing_provider / missing_mode / runtime_unavailable).
      const ev: VoiceRuntimeEvent = {
        kind: "error",
        code: resolved.error,
        message: resolveFailureMessage(resolved.error),
      };
      this.log(`session error: ${resolved.error}`);
      return this.emitTerminalAfterFloor(ev, active);
    }
    const context = resolved;

    let outcome: SessionRunOutcome;
    try {
      if (context.dispose !== undefined) {
        this.disposeCurrentRun();
        this.currentRunDispose = context.dispose;
      }
      const previousBeforeInject = context.deps.beforeInject;
      const deps: VoiceSessionDeps = {
        ...context.deps,
        beforeInject: async (prepared) => {
          const decision = await this.emitInsertingAfterFloor(active);
          if (decision === "superseded") throw new SessionSupersededError();
          await previousBeforeInject?.(prepared);
        },
      };
      outcome = await runVoiceSession(deps, {
        sessionId: active.sessionId,
        modeId: active.modeId,
        modePrompt: context.modePrompt,
        recording: {
          audioB64: push.wavBase64,
          audioFormat: "wav",
          durationMs: push.durationMs,
          peak: push.peak,
          voicedMs: push.voicedMs,
        },
        savedApp: targetContext.savedApp,
        axContextAtStart: targetContext.axContext,
        appContext: targetContext.appContext,
        snapshot: targetContext.snapshot,
        // Target metadata derives from the focus snapshot taken at start.
        target: {
          app: targetContext.savedApp?.bundleId ?? null,
          windowTitle: targetContext.axContext?.window_title ?? null,
          controlType: targetContext.axContext?.ax_role ?? null,
        },
      });
    } catch (error) {
      if (error instanceof SessionSupersededError) return "superseded";
      // Provider/model-runtime failure -> generic error event (Rust:
      // VoiceRuntimeOutcome::Error { Generic }).
      const ev: VoiceRuntimeEvent = {
        kind: "error",
        code: "generic",
        message: messageOf(error),
      };
      this.log(`session error: ${messageOf(error)}`);
      return this.emitTerminalAfterFloor(ev, active);
    } finally {
      if (this.currentRunDispose === context.dispose) {
        this.disposeCurrentRun();
      }
    }

    await this.settleInsertion(outcome);
    const terminal = terminalEventFor(outcome);
    const display = await this.emitTerminalAfterFloor(terminal, active);
    this.log(
      `session ${outcome.status}: final=${outcome.finalText.length} chars, ` +
        `injection=${outcome.injectionOutcome.kind}`,
    );
    return display;
  }

}

class SessionSupersededError extends Error {}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function exitIntentForEvent(event: VoiceRuntimeEvent): CapsuleExitIntent {
  switch (event.kind) {
    case "cancelled":
      return "cancel";
    case "failed":
    case "error":
      return "error";
    case "completed":
      if (event.empty_reason !== undefined) return "notice";
      switch (event.injection_outcome.kind) {
        case "paste_sent":
        case "no_op":
          return "success";
        case "failed":
          return "error";
        case "focus_lost":
        case "manual_copy_required":
          return "notice";
      }
    case "started":
    case "thinking":
    case "inserting":
    case "level":
    case "slow":
      return "default";
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function focusStartForLog(
  modeId: string,
  sessionId: string,
  targetContext: AcquiredContext,
): string {
  const ax = targetContext.axContext;
  const saved = targetContext.savedApp;
  return (
    `[focus-diag] session-start mode=${modeId} session=${short(sessionId)} ` +
    `focus=${targetContext.focusStatus} saved=${appForLog(saved)} ` +
    `ax_role=${ax?.ax_role ?? "null"} ax_app=${ax?.app_bundle_id ?? "null"} ` +
    `window_title_chars=${ax?.window_title?.length ?? 0} ` +
    `selection_source=${targetContext.selectionSource}`
  );
}

function appForLog(app: AppInfo | null): string {
  if (app === null) return "null";
  return `{pid=${app.pid},bundle=${app.bundleId ?? "null"},name=${app.localizedName}}`;
}

/** Human-readable message for a session-resolve failure (becomes the Panel detail). */
function resolveFailureMessage(code: VoiceRuntimeErrorCode): string {
  switch (code) {
    case "missing_provider":
      return "No active provider configuration. Add one in settings.";
    case "missing_mode":
      return "The selected mode no longer exists. Pick a mode in Modes.";
    case "runtime_unavailable":
      return "The voice runtime is unavailable in this build.";
    case "generic":
      return "Could not start a session.";
  }
}

/** Short session id for log lines (full uuid is noise). */
function short(sessionId: string): string {
  return sessionId.slice(0, 8);
}
