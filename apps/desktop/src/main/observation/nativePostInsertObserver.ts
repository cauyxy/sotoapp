import type {
  AppInfo,
  AxContext,
  PostInsertObservation,
  PostInsertObservationHandle,
  PostInsertObserver,
  PostInsertObserverRequest,
} from "@soto/core";
import { DEFAULT_TARGET_CONTEXT_CAPTURE_DEADLINE_MS } from "../context/acquireTargetContext.js";

const MAX_TIMEOUT_MS = 45_000;
const DEFAULT_POLL_MS = 250;

type MaybePromise<T> = T | Promise<T>;
type DeadlineResult<T> = { value: T; timedOut: boolean };

export interface NativePostInsertObserverOptions {
  frontmostApp(): MaybePromise<AppInfo | null>;
  captureAxContext(): MaybePromise<AxContext | null>;
  captureWindowTitle(): MaybePromise<string | null>;
  pollMs?: number;
  captureDeadlineMs?: number;
}

export class NativePostInsertObserver implements PostInsertObserver {
  constructor(private readonly options: NativePostInsertObserverOptions) {}

  start(request: PostInsertObserverRequest): PostInsertObservationHandle {
    if (!baselineCanBeObserved(request)) {
      request.onObservation(unavailable("unsupported_injection_outcome"));
      return noopHandle;
    }
    if (!targetIdentityCanBeObserved(request)) {
      request.onObservation(unavailable("observer_unsupported"));
      return noopHandle;
    }

    let cancelled = false;
    let pollInFlight = false;
    let lastStable: { text: string; ax: AxContext | null } | null = null;
    const finish = (observation: PostInsertObservation): void => {
      if (cancelled) return;
      cancelled = true;
      clearTimeout(firstPollTimer);
      clearInterval(pollTimer);
      clearTimeout(timeoutTimer);
      request.onObservation(observation);
    };
    const handleSnapshot = (
      snapshot:
        | { kind: "readable"; text: string; ax: AxContext | null }
        | { kind: "target_changed" }
        | { kind: "unreadable" },
    ): void => {
      if (snapshot.kind === "target_changed") {
        if (lastStable !== null) {
          finish(captured(lastStable));
          return;
        }
        finish(unavailable("target_changed"));
        return;
      }
      if (snapshot.kind === "unreadable") return;

      const text = snapshot.text.trim();
      if (text.length > 0 && textCanBeCaptured(text, request)) {
        lastStable = { text: snapshot.text, ax: snapshot.ax };
      }
    };
    const poll = (): void => {
      if (cancelled || pollInFlight) return;
      pollInFlight = true;
      void this.readSnapshot(request)
        .then(handleSnapshot)
        .finally(() => {
          pollInFlight = false;
        });
    };
    const finishTimeout = (): void => {
      if (lastStable !== null) {
        finish(captured(lastStable));
        return;
      }
      finish(unavailable("observer_timeout"));
    };

    const firstPollTimer = setTimeout(poll, 0);
    if (typeof firstPollTimer.unref === "function") firstPollTimer.unref();
    const pollTimer = setInterval(poll, this.options.pollMs ?? DEFAULT_POLL_MS);
    if (typeof pollTimer.unref === "function") pollTimer.unref();
    const timeoutTimer = setTimeout(
      finishTimeout,
      Math.min(request.timeoutMs, MAX_TIMEOUT_MS),
    );
    if (typeof timeoutTimer.unref === "function") timeoutTimer.unref();

    return {
      cancel: () => {
        if (cancelled) return;
        cancelled = true;
        clearTimeout(firstPollTimer);
        clearInterval(pollTimer);
        clearTimeout(timeoutTimer);
      },
    };
  }

  private async readSnapshot(
    request: PostInsertObserverRequest,
  ): Promise<
    | { kind: "readable"; text: string; ax: AxContext | null }
    | { kind: "target_changed" }
    | { kind: "unreadable" }
  > {
    const deadlineMs =
      this.options.captureDeadlineMs ?? DEFAULT_TARGET_CONTEXT_CAPTURE_DEADLINE_MS;
    const deadlineAt = Date.now() + Math.max(0, deadlineMs);
    const currentAppResult = await safeAsync(
      () => this.options.frontmostApp(),
      null,
      deadlineAt,
    );
    if (currentAppResult.timedOut) return { kind: "unreadable" };

    const axResult = await safeAsync(
      () => this.options.captureAxContext(),
      null,
      deadlineAt,
    );
    if (axResult.timedOut) return { kind: "unreadable" };

    const windowTitleResult = await safeAsync(
      () => this.options.captureWindowTitle(),
      null,
      deadlineAt,
    );
    if (windowTitleResult.timedOut) return { kind: "unreadable" };

    const currentApp = currentAppResult.value;
    const ax = axResult.value;
    const windowTitle =
      nonEmpty(windowTitleResult.value) ?? nonEmpty(ax?.window_title ?? null);
    if (!targetStillMatches(request, currentApp, ax, windowTitle)) {
      return { kind: "target_changed" };
    }

    const text = ax?.full_text ?? null;
    if (text === null) return { kind: "unreadable" };
    return { kind: "readable", text, ax };
  }
}

function baselineCanBeObserved(request: PostInsertObserverRequest): boolean {
  return request.injectionOutcome.kind === "paste_sent";
}

function targetIdentityCanBeObserved(request: PostInsertObserverRequest): boolean {
  if (request.target.ax === null) return true;
  return nonEmpty(request.target.ax.focused_element_id ?? null) !== null;
}

function targetStillMatches(
  request: PostInsertObserverRequest,
  currentApp: AppInfo | null,
  ax: AxContext | null,
  currentWindowTitle: string | null,
): boolean {
  const expectedBundle = request.target.app.bundleId ?? request.target.ax?.app_bundle_id ?? null;
  const currentBundle = currentApp?.bundleId ?? ax?.app_bundle_id ?? null;
  if (expectedBundle !== null) {
    if (currentBundle === null || expectedBundle !== currentBundle) return false;
  }

  const expectedPid = request.target.app.pid;
  if (expectedPid !== null) {
    if (currentApp === null || expectedPid !== currentApp.pid) return false;
  }

  const expectedName = request.target.app.localizedName ?? request.target.ax?.app_name ?? null;
  const currentName = currentApp?.localizedName ?? ax?.app_name ?? null;
  if (expectedName !== null) {
    if (currentName === null || expectedName !== currentName) return false;
  }

  const expectedWindow = request.target.window.title ?? request.target.ax?.window_title ?? null;
  if (expectedWindow !== null) {
    if (currentWindowTitle === null || expectedWindow !== currentWindowTitle) return false;
  }

  const expectedAxElementId = request.target.ax?.focused_element_id ?? null;
  const expectedFocusedElementId =
    request.target.focusedElement?.valueSignature ?? null;
  const expectedElementId =
    request.target.ax !== null ? expectedAxElementId : expectedFocusedElementId;
  const currentElementId = ax?.focused_element_id ?? null;
  if (request.target.ax !== null || expectedElementId !== null) {
    if (expectedElementId === null || currentElementId === null) return false;
    if (expectedElementId !== currentElementId) return false;
  }

  const expectedRole =
    request.target.focusedElement?.axRole ?? request.target.ax?.ax_role ?? null;
  const currentRole = ax?.ax_role ?? null;
  if (expectedRole !== null) {
    if (
      (isWindowsTextProvenance(expectedRole) ||
        (currentRole !== null && isWindowsTextProvenance(currentRole))) &&
      (expectedElementId === null || currentElementId === null)
    ) {
      return false;
    }
    if (currentRole === null || !rolesCompatible(expectedRole, currentRole)) {
      return false;
    }
  }

  return true;
}

function textCanBeCaptured(
  observedText: string,
  request: PostInsertObserverRequest,
): boolean {
  const observed = observedText.trim();
  const injected = request.injectedText.trim();
  if (observed.length === 0 || injected.length === 0) return false;
  if (!observed.includes(injected)) return false;

  const baseline = textBaselineOf(request.target.ax);
  if (baseline === null) return false;
  const trimmedBaseline = baseline.trim();
  if (trimmedBaseline.length > 0 && observed === trimmedBaseline) return false;
  return true;
}

function textBaselineOf(ax: AxContext | null): string | null {
  if (ax === null) return null;
  if (ax.full_text.trim().length > 0) return ax.full_text;
  if (
    ax.selection_start === 0 &&
    ax.selection_end === 0 &&
    ax.before.length === 0 &&
    ax.after.length === 0 &&
    ax.ax_role === null
  ) {
    return null;
  }
  return ax.full_text;
}

function rolesCompatible(expectedRole: string, currentRole: string): boolean {
  if (expectedRole === currentRole) return true;
  return isWindowsTextProvenance(expectedRole) && isWindowsTextProvenance(currentRole);
}

function isWindowsTextProvenance(role: string): boolean {
  return role === "TextPattern" || role === "ValuePattern";
}

function unavailable(
  edited_text_status_reason: PostInsertObservation["edited_text_status_reason"],
): PostInsertObservation {
  return {
    edited_text: null,
    edited_text_status: "unavailable",
    edited_text_status_reason,
    ax_context_at_end: null,
  };
}

function captured(stable: { text: string; ax: AxContext | null }): PostInsertObservation {
  return {
    edited_text: stable.text,
    edited_text_status: "captured",
    edited_text_status_reason: null,
    ax_context_at_end: stable.ax,
  };
}

async function safeAsync<T>(
  fn: () => MaybePromise<T>,
  fallback: T,
  deadlineAt: number,
): Promise<DeadlineResult<T>> {
  const remainingMs = Math.max(0, deadlineAt - Date.now());
  if (remainingMs <= 0) return { value: fallback, timedOut: true };
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
    return result === timedOut
      ? { value: fallback, timedOut: true }
      : { value: result as T, timedOut: false };
  } catch {
    return { value: fallback, timedOut: false };
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

function nonEmpty(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const noopHandle: PostInsertObservationHandle = {
  cancel() {},
};
