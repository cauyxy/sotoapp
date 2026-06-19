import {
  isSameApp,
  tierPlanFor,
  type AppInfo,
  type InjectionOutcome,
  type InjectionTargetContinuity,
  type Injector,
  type ManualFallbackReason,
  type SessionTarget,
  type VoiceSessionInjectionOptions,
} from "@soto/core";
import type {
  InjectionNativePort,
  NativeTextAttemptOperation,
  NativeTextAttemptResult,
} from "@soto/native-bridge";
import { ClipboardLease } from "./clipboardLease.js";

export interface PlatformInjectorOpts {
  sleep?: (ms: number) => Promise<void>;
  platform?: NodeJS.Platform;
  log?: (message: string) => void;
}

const ACTIVATE_SETTLE_MS = 50;
const PASTE_RESTORE_SETTLE_MS = 180;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

interface FocusProtectionResult {
  outcome: InjectionOutcome | null;
  continuity: InjectionTargetContinuity;
}

export function createPlatformInjector(
  native: InjectionNativePort,
  opts: PlatformInjectorOpts = {},
): Injector {
  const sleep = opts.sleep ?? defaultSleep;
  const platform = opts.platform ?? process.platform;
  const log: (message: string) => void = opts.log ?? (() => {});
  const lease = new ClipboardLease(native);

  function focusDiag(message: string): void {
    log(`[focus-diag] injector ${message}`);
  }

  function manualFallback(reason: ManualFallbackReason): InjectionOutcome {
    return { kind: "manual_copy_required", reason };
  }

  function focusLost(saved: AppInfo, actual: AppInfo): InjectionOutcome {
    return {
      kind: "focus_lost",
      detail: { saved_app_name: saved.localizedName, actual_app_name: actual.localizedName },
    };
  }

  async function protectFocus(savedApp: AppInfo): Promise<FocusProtectionResult> {
    let actual: AppInfo;
    try {
      actual = native.frontmostApp();
    } catch {
      focusDiag(`frontmost-before status=unavailable saved=${appForLog(savedApp)}`);
      return { outcome: null, continuity: "unknown" };
    }

    focusDiag(`frontmost-before actual=${appForLog(actual)} saved=${appForLog(savedApp)}`);
    if (isSameApp(savedApp, actual)) return { outcome: null, continuity: "same_app" };

    try {
      focusDiag(`activate-saved pid=${savedApp.pid}`);
      native.activateApp(savedApp.pid);
    } catch {
      focusDiag(`activate-saved failed actual=${appForLog(actual)} saved=${appForLog(savedApp)}`);
      return { outcome: focusLost(savedApp, actual), continuity: "lost_app" };
    }

    await sleep(ACTIVATE_SETTLE_MS);

    let actualAfter: AppInfo;
    try {
      actualAfter = native.frontmostApp();
    } catch {
      focusDiag(`frontmost-after status=unavailable saved=${appForLog(savedApp)}`);
      return { outcome: null, continuity: "unknown" };
    }
    focusDiag(
      `frontmost-after actual=${appForLog(actualAfter)} saved=${appForLog(savedApp)} ` +
        `same=${isSameApp(savedApp, actualAfter)}`,
    );
    if (!isSameApp(savedApp, actualAfter)) {
      return {
        outcome: focusLost(savedApp, actualAfter),
        continuity: "lost_app",
      };
    }
    return { outcome: null, continuity: "restored_app" };
  }

  async function attemptPaste(text: string): Promise<InjectionOutcome> {
    let acquired;
    try {
      acquired = lease.acquirePaste(text);
    } catch {
      focusDiag("tier=paste lease=threw");
      return manualFallback("clipboard_busy");
    }
    if (!acquired.ok) {
      focusDiag(`tier=paste lease=blocked reason=${acquired.reason}`);
      return manualFallback(acquired.reason);
    }
    const active = acquired.lease;

    let result: NativeTextAttemptResult;
    try {
      result = native.sendPasteDetailed();
    } catch {
      result = nativeAttemptException("send_paste");
    }
    focusDiag(`tier=paste send_ok=${result.ok} status=${attemptStatusForLog(result)}`);
    if (!result.ok) {
      active.restore();
      return manualFallback("paste_send_failed");
    }

    await settleBeforeClipboardRestore();
    active.restore();
    return { kind: "paste_sent", method: "paste" };
  }

  async function runPaste(
    text: string,
    targetContinuity: InjectionTargetContinuity,
  ): Promise<InjectionOutcome> {
    const probe = await safeProbe(native);
    focusDiag(`tier=paste pre_probe=${probe} continuity=${targetContinuity}`);
    return attemptPaste(text);
  }

  async function settleBeforeClipboardRestore(): Promise<void> {
    await sleep(PASTE_RESTORE_SETTLE_MS);
  }

  return {
    async inject(
      text: string,
      savedApp: AppInfo | null,
      _target: SessionTarget,
      options?: VoiceSessionInjectionOptions,
    ): Promise<InjectionOutcome> {
      const trimmed = text.trim();
      const initialProbe = await safeProbe(native);
      focusDiag(
        `inject-start mode=${options?.modeId ?? "(unknown)"} command=${options?.command === true} ` +
          `platform=${platform} text_chars=${[...trimmed].length} ` +
          `saved=${appForLog(savedApp)} target=${targetForLog(_target)} initial_probe=${initialProbe}`,
      );

      if (trimmed === "") {
        const outcome: InjectionOutcome = { kind: "no_op" };
        focusDiag(`inject-outcome ${outcomeForLog(outcome)}`);
        return outcome;
      }
      if (savedApp === null) {
        const outcome = manualFallback("paste_unverified");
        focusDiag(`inject-outcome ${outcomeForLog(outcome)}`);
        return outcome;
      }

      const protectedFocus = await protectFocus(savedApp);
      const targetContinuity = protectedFocus.continuity;
      if (protectedFocus.outcome !== null) {
        focusDiag(`inject-outcome ${outcomeForLog(protectedFocus.outcome)}`);
        return protectedFocus.outcome;
      }
      if (targetContinuity === "unknown") {
        const outcome = manualFallback("paste_unverified");
        focusDiag(`inject-outcome ${outcomeForLog(outcome)}`);
        return outcome;
      }

      const probe = await safeProbe(native);
      focusDiag(`post-focus-probe=${probe}`);
      const clipboardSnapshotKind = lease.snapshotKind();
      const plan = tierPlanFor({
        text: trimmed,
        clipboardSnapshotKind,
      });
      focusDiag(
        `plan probe=${probe} clipboard=${clipboardSnapshotKind} ` +
          `continuity=${targetContinuity} tiers=${plan.tiers.join(",") || "(none)"} ` +
          `manual_fallback=${plan.manualFallbackReason ?? "(none)"}`,
      );

      if (plan.manualFallbackReason !== null) {
        const outcome = manualFallback(plan.manualFallbackReason);
        focusDiag(`inject-outcome ${outcomeForLog(outcome)}`);
        return outcome;
      }

      if (plan.tiers.includes("paste")) {
        const outcome = await runPaste(plan.text, targetContinuity);
        focusDiag(`inject-outcome ${outcomeForLog(outcome)}`);
        return outcome;
      }

      const outcome = manualFallback("paste_unverified");
      focusDiag(`inject-outcome ${outcomeForLog(outcome)}`);
      return outcome;
    },
  };
}

function nativeAttemptException(
  operation: NativeTextAttemptOperation,
): Extract<NativeTextAttemptResult, { ok: false }> {
  return {
    ok: false,
    operation,
    status: "error",
    detail: "native_exception",
    platform_code: -100,
  };
}

function attemptStatusForLog(result: NativeTextAttemptResult): string {
  if (result.ok) return `ok code=${result.platform_code}`;
  return `${result.status}:${result.detail} code=${result.platform_code ?? "null"}`;
}

async function safeProbe(native: InjectionNativePort) {
  try {
    return native.probeFocusAsync ? await native.probeFocusAsync() : native.probeFocus();
  } catch {
    return "unknown";
  }
}

function appForLog(app: AppInfo | null): string {
  if (app === null) return "null";
  return `{pid=${app.pid},bundle=${app.bundleId ?? "null"},name=${app.localizedName}}`;
}

function targetForLog(target: SessionTarget): string {
  return (
    `{app=${target.app ?? "null"},window_title_chars=${target.windowTitle?.length ?? 0},` +
    `control=${target.controlType ?? "null"}}`
  );
}

function outcomeForLog(outcome: InjectionOutcome): string {
  switch (outcome.kind) {
    case "paste_sent":
      return "kind=paste_sent";
    case "manual_copy_required":
      return `kind=manual_copy_required reason=${outcome.reason ?? "unknown"}`;
    case "focus_lost":
      return `kind=focus_lost saved=${outcome.detail.saved_app_name} actual=${outcome.detail.actual_app_name}`;
    case "failed":
      return `kind=failed detail=${outcome.detail}`;
    case "no_op":
      return "kind=no_op";
  }
}
