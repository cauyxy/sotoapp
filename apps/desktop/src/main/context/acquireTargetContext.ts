import {
  buildAppContext,
  selectedTextOf,
  type AppContext,
  type AppInfo,
  type AxContext,
  type FocusProbeStatus,
  type TargetContextCaptureOptions,
  type TargetContextCaptureReason,
  type TargetContextSnapshot,
} from "@soto/core";

export const DEFAULT_TARGET_CONTEXT_CAPTURE_DEADLINE_MS = 350;

type MaybePromise<T> = T | Promise<T>;

export interface TargetContextPorts {
  frontmostApp(): AppInfo | null;
  captureAxContext(): MaybePromise<AxContext | null>;
  captureWindowTitle(): MaybePromise<string | null>;
  probeFocus(): MaybePromise<FocusProbeStatus>;
  now(): number;
  uuid(): string;
  log?(message: string): void;
  captureDeadlineMs?: number;
}

export interface AcquiredContext {
  sessionId: string;
  capturedAt: number;
  focusStatus: FocusProbeStatus;
  savedApp: AppInfo | null;
  axContext: AxContext | null;
  snapshot: TargetContextSnapshot;
  appContext: AppContext;
  selectedText: string;
  selectionSource: TargetContextSnapshot["selection"]["source"];
}

export async function acquireTargetContext(
  ports: TargetContextPorts,
  reason: TargetContextCaptureReason,
  options: TargetContextCaptureOptions,
  includeWindowContextInRequests: boolean,
): Promise<AcquiredContext> {
  const deadlineMs =
    ports.captureDeadlineMs ?? DEFAULT_TARGET_CONTEXT_CAPTURE_DEADLINE_MS;
  const deadlineAt = ports.now() + Math.max(0, deadlineMs);
  const capturedAt = ports.now();
  const sessionId = sessionIdFor(reason, capturedAt, ports.uuid);
  const savedApp = safe(() => ports.frontmostApp(), null);
  const focusStatus = await safeAsync(
    ports,
    "probeFocus",
    () => ports.probeFocus(),
    "timeout" satisfies FocusProbeStatus,
    deadlineAt,
  );

  const rawAxContext = await safeAsync(
    ports,
    "captureAxContext",
    () => ports.captureAxContext(),
    null,
    deadlineAt,
  );
  const windowTitle =
    reason === "voice_session_start"
      ? await safeAsync(
          ports,
          "captureWindowTitle",
          () => ports.captureWindowTitle(),
          null,
          deadlineAt,
        )
      : null;

  let axContext =
    reason === "voice_session_start"
      ? mergeSessionContext(rawAxContext, savedApp, windowTitle)
      : rawAxContext;
  let selectedText = selectedTextOf(axContext);
  let selectionSource: AcquiredContext["selectionSource"] =
    selectedText.length > 0 ? "ax_selection" : "none";

  const finish = (
    finalAxContext: AxContext | null,
    finalSelectedText: string,
    finalSelectionSource: AcquiredContext["selectionSource"],
  ): AcquiredContext => {
    const snapshot = targetSnapshotFor({
      sessionId,
      capturedAt,
      reason,
      savedApp,
      axContext: finalAxContext,
      selectedText: finalSelectedText,
      selectionSource: finalSelectionSource,
    });
    const appContext = buildAppContext({
      target: snapshot,
      settings: {
        includeWindowContextInRequests,
        clipboardContextInRequests: options.clipboardContextMode,
      },
    });

    return {
      sessionId,
      capturedAt,
      focusStatus,
      savedApp,
      axContext: finalAxContext,
      snapshot,
      appContext,
      selectedText: finalSelectedText,
      selectionSource: finalSelectionSource,
    };
  };

  return finish(axContext, selectedText, selectionSource);
}

function sessionIdFor(
  reason: TargetContextCaptureReason,
  capturedAt: number,
  uuid: () => string,
): string {
  if (reason === "voice_session_start") return `voice-target.${capturedAt}`;
  return `target.${uuid()}`;
}

function targetSnapshotFor(input: {
  sessionId: string;
  capturedAt: number;
  reason: TargetContextCaptureReason;
  savedApp: AppInfo | null;
  axContext: AxContext | null;
  selectedText: string;
  selectionSource: TargetContextSnapshot["selection"]["source"];
}): TargetContextSnapshot {
  const ax = input.axContext;
  const axRole = ax?.ax_role ?? null;
  return {
    id: input.sessionId,
    capturedAt: input.capturedAt,
    reason: input.reason,
    platform: process.platform === "win32" ? "windows" : "macos",
    app: {
      pid: input.savedApp?.pid ?? null,
      bundleId: input.savedApp?.bundleId ?? ax?.app_bundle_id ?? null,
      localizedName: input.savedApp?.localizedName ?? ax?.app_name ?? null,
      executableName: null,
    },
    window: { title: ax?.window_title ?? null },
    ax,
    focusedElement:
      axRole === null
        ? null
        : {
            axRole,
            isSecureTextEntry: null,
            bounds: null,
            valueSignature: null,
          },
    selection:
      input.selectedText.length > 0
        ? {
            text: input.selectedText,
            source: input.selectionSource,
            confidence: input.selectionSource === "ax_selection" ? "high" : "medium",
          }
        : { text: "", source: "none", confidence: "low" },
    ambientClipboard: null,
  };
}

function emptyAxContext(): AxContext {
  return {
    full_text: "",
    selection_start: 0,
    selection_end: 0,
    before: "",
    after: "",
    ax_role: null,
    app_bundle_id: null,
    app_name: null,
    window_title: null,
    web_url: null,
    web_domain: null,
  };
}

function mergeSessionContext(
  base: AxContext | null,
  app: AppInfo | null,
  windowTitle: string | null,
): AxContext | null {
  const bundleId = nonEmpty(app?.bundleId ?? base?.app_bundle_id ?? null);
  const appName = nonEmpty(app?.localizedName ?? base?.app_name ?? null);
  const title = nonEmpty(windowTitle ?? base?.window_title ?? null);
  if (base === null && bundleId === null && appName === null && title === null) {
    return null;
  }
  return {
    ...(base ?? emptyAxContext()),
    app_bundle_id: bundleId,
    app_name: appName,
    window_title: title,
  };
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

async function safeAsync<T>(
  ports: Pick<TargetContextPorts, "now" | "log">,
  stage: string,
  fn: () => MaybePromise<T>,
  fallback: T,
  deadlineAt: number,
): Promise<T> {
  const startedAt = ports.now();
  const remainingMs = Math.max(0, deadlineAt - startedAt);
  if (remainingMs <= 0) {
    logCaptureStage(ports, stage, 0, true);
    return fallback;
  }
  const timedOut = Symbol("timed_out");
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeout = new Promise<typeof timedOut>((resolve) => {
      timer = setTimeout(() => resolve(timedOut), remainingMs);
      if (typeof timer.unref === "function") timer.unref();
    });
    const result = await Promise.race([
      Promise.resolve().then(fn),
      timeout,
    ]);
    if (result === timedOut) {
      logCaptureStage(ports, stage, ports.now() - startedAt, true);
      return fallback;
    }
    logCaptureStage(ports, stage, ports.now() - startedAt, false);
    return result as T;
  } catch {
    logCaptureStage(ports, stage, ports.now() - startedAt, false);
    return fallback;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

function logCaptureStage(
  ports: Pick<TargetContextPorts, "log">,
  stage: string,
  elapsedMs: number,
  timedOut: boolean,
): void {
  ports.log?.(
    `[focus-diag] capture stage=${stage} elapsed_ms=${Math.max(
      0,
      Math.round(elapsedMs),
    )} timed_out=${timedOut ? "true" : "false"}`,
  );
}
