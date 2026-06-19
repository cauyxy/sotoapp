// Wraps the raw koffi C-ABI (koffiAbi.ts) into the typed ports the rest of the
// app consumes: the focus-protection InjectionNativePort, an AX-capture port, a
// permissions port, and a hotkey controller. `tryLoadNative()` is the single
// entry point; it returns null when the native layer is unavailable so callers
// fall back to the JS stub (createStubNativeBridge).

import type {
  AppInfo,
  AxContext,
  ClipboardSnapshotKind,
  FocusProbeStatus,
} from "@soto/core/contract/schema";
import type {
  NativeBridge,
  PermissionPane,
  PermissionStatus,
  PermissionStatusKind,
} from "./index.js";
import {
  loadNativeAbi,
  type NormalizedKeyEvent,
  type RawAxStruct,
  type SotoNativeAbi,
} from "./koffiAbi.js";

/**
 * The native-capability subset the koffi-backed NativeBridge implements for
 * text injection. This is the shared "native capability contract" between the
 * koffi provider (here) and the focus-protected injection consumer (the app's
 * platformInjector). Mirrors the Rust Platform sub-traits AppControl /
 * TextInjection / ClipboardAccess, collapsed to the calls the injector needs:
 *
 *  - frontmostApp / clipboardGet / clipboardSet / activateApp throw on a
 *    platform error (the consumer only distinguishes success vs failure).
 *  - sendPaste returns true on success, false on failure (a failed paste send
 *    becomes Failed, not a retry).
 */
export interface InjectionNativePort {
  frontmostApp(): AppInfo;
  frontmostWindowBounds?(): NativeWindowBounds | null;
  activateApp(pid: number): void;
  probeFocus(): FocusProbeStatus;
  probeFocusAsync?(): Promise<FocusProbeStatus>;
  sendPaste(): boolean;
  sendPasteDetailed(): NativeTextAttemptResult;
  clipboardGet(): string;
  clipboardSet(s: string): void;
  clipboardSnapshotKind(): ClipboardSnapshotKind;
  clipboardCapture?(): boolean;
  clipboardRestore?(): boolean;
  clipboardSetTransient(s: string): void;
  clipboardPreparePasteText?(s: string): ClipboardProductOperationResult;
  clipboardRestoreAfterPaste?(): ClipboardProductOperationResult;
  clipboardCopyUserText?(s: string): boolean;
}

export type ClipboardProductOperationResult = "ok" | "busy" | "unrestorable" | "failed";

export interface NativeWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Permission panes are passed to the native layer as ints. The mapping is shared
// by Swift and C# exports.
const PANE_INDEX: Record<PermissionPane, number> = {
  microphone: 0,
  accessibility: 1,
};
const ALL_PANES: PermissionPane[] = ["microphone", "accessibility"];

export function permissionKindFor(code: number): PermissionStatusKind {
  switch (code) {
    case 0:
      return "not_determined";
    case 1:
      return "restricted";
    case 2:
      return "denied";
    case 3:
      return "granted";
    case 5:
      return "not_required";
    default:
      return "unknown";
  }
}

function permissionLabel(kind: PermissionStatusKind): string {
  switch (kind) {
    case "granted":
      return "Ready";
    case "not_required":
      return "Not required";
    case "not_determined":
      return "Not requested";
    case "restricted":
      return "Restricted";
    case "denied":
      return "Needs review";
    case "unknown":
      return "Unknown";
  }
}

function parseWindowBounds(raw: string | null): NativeWindowBounds | null {
  if (raw === null || raw.length === 0) return null;
  const parts = raw.split(",").map((part) => Number(part));
  const [x, y, width, height] = parts;
  if (
    parts.length !== 4 ||
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined ||
    ![x, y, width, height].every((value) => Number.isFinite(value)) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return { x, y, width, height };
}

function permissionDetail(pane: PermissionPane, kind: PermissionStatusKind): string {
  if (kind === "granted") return "Permission is granted.";
  if (kind === "not_required") return "Windows does not require this Soto permission gate.";
  if (kind === "not_determined") return "Permission has not been requested yet.";
  if (kind === "restricted") return "The operating system is restricting this permission.";
  if (kind === "denied") return "Open system settings and grant this permission to Soto.";
  return `Soto could not determine the ${pane.replace("_", " ")} permission state.`;
}

export function permissionStatus(pane: PermissionPane, code: number): PermissionStatus {
  const status = permissionKindFor(code);
  const granted = status === "granted" || status === "not_required";
  return {
    pane,
    granted,
    status,
    label: permissionLabel(status),
    detail: permissionDetail(pane, status),
  };
}

const NATIVE_ATTEMPT_OK = 0;
const NATIVE_ATTEMPT_INVALID_ARGUMENT = -1;
const NATIVE_ATTEMPT_SEND_INPUT_INCOMPLETE = -2;
const NATIVE_ATTEMPT_NOT_TRUSTED = -3;
const NATIVE_ATTEMPT_SECURE_EVENT_INPUT = -4;
const NATIVE_ATTEMPT_SECURE_TEXT_FIELD = -5;
const NATIVE_ATTEMPT_NO_FOCUSED_ELEMENT = -6;
const NATIVE_ATTEMPT_NOT_EDITABLE = -7;
const NATIVE_ATTEMPT_EVENT_SOURCE_UNAVAILABLE = -8;
const NATIVE_ATTEMPT_EVENT_CREATE_FAILED = -9;
const NATIVE_ATTEMPT_EVENT_POST_FAILED = -10;
const NATIVE_ATTEMPT_BLOCKED_ELEVATED = -11;
const NATIVE_ATTEMPT_PASSWORD_FIELD = -12;
const NATIVE_ATTEMPT_SYMBOL_UNAVAILABLE = -98;
const NATIVE_ATTEMPT_NATIVE_EXCEPTION = -100;

export type NativeTextAttemptOperation = "send_paste";

export type NativeTextAttemptStatus =
  | "permission_denied"
  | "protected"
  | "not_found"
  | "unsupported"
  | "unavailable"
  | "error";

export type NativeTextAttemptDetail =
  | "not_trusted"
  | "secure_event_input"
  | "secure_text_field"
  | "password_field"
  | "blocked_elevated"
  | "no_focused_element"
  | "not_editable"
  | "selection_behavior_unsupported"
  | "event_source_unavailable"
  | "event_create_failed"
  | "event_post_failed"
  | "send_input_incomplete"
  | "native_library_unavailable"
  | "symbol_unavailable"
  | "invalid_argument"
  | "native_exception"
  | "unknown";

export type NativeTextAttemptResult =
  | { ok: true; operation: NativeTextAttemptOperation; platform_code: number }
  | {
      ok: false;
      operation: NativeTextAttemptOperation;
      status: NativeTextAttemptStatus;
      detail: NativeTextAttemptDetail;
      platform_code: number | null;
    };

export function nativeTextAttemptResultForRaw(
  _platform: "darwin" | "win32",
  operation: NativeTextAttemptOperation,
  code: number | null,
): NativeTextAttemptResult {
  if (code === NATIVE_ATTEMPT_OK) {
    return { ok: true, operation, platform_code: NATIVE_ATTEMPT_OK };
  }
  if (code === null) {
    return nativeTextAttemptFailure(operation, "unavailable", "symbol_unavailable", null);
  }

  switch (code) {
    case NATIVE_ATTEMPT_INVALID_ARGUMENT:
      return nativeTextAttemptFailure(operation, "error", "invalid_argument", code);
    case NATIVE_ATTEMPT_SEND_INPUT_INCOMPLETE:
      return nativeTextAttemptFailure(operation, "error", "send_input_incomplete", code);
    case NATIVE_ATTEMPT_NOT_TRUSTED:
      return nativeTextAttemptFailure(operation, "permission_denied", "not_trusted", code);
    case NATIVE_ATTEMPT_SECURE_EVENT_INPUT:
      return nativeTextAttemptFailure(operation, "protected", "secure_event_input", code);
    case NATIVE_ATTEMPT_SECURE_TEXT_FIELD:
      return nativeTextAttemptFailure(operation, "protected", "secure_text_field", code);
    case NATIVE_ATTEMPT_NO_FOCUSED_ELEMENT:
      return nativeTextAttemptFailure(operation, "not_found", "no_focused_element", code);
    case NATIVE_ATTEMPT_NOT_EDITABLE:
      return nativeTextAttemptFailure(operation, "unsupported", "not_editable", code);
    case NATIVE_ATTEMPT_EVENT_SOURCE_UNAVAILABLE:
      return nativeTextAttemptFailure(operation, "unavailable", "event_source_unavailable", code);
    case NATIVE_ATTEMPT_EVENT_CREATE_FAILED:
      return nativeTextAttemptFailure(operation, "error", "event_create_failed", code);
    case NATIVE_ATTEMPT_EVENT_POST_FAILED:
      return nativeTextAttemptFailure(operation, "error", "event_post_failed", code);
    case NATIVE_ATTEMPT_BLOCKED_ELEVATED:
      return nativeTextAttemptFailure(operation, "protected", "blocked_elevated", code);
    case NATIVE_ATTEMPT_PASSWORD_FIELD:
      return nativeTextAttemptFailure(operation, "protected", "password_field", code);
    case NATIVE_ATTEMPT_SYMBOL_UNAVAILABLE:
      return nativeTextAttemptFailure(operation, "unavailable", "symbol_unavailable", code);
    case NATIVE_ATTEMPT_NATIVE_EXCEPTION:
      return nativeTextAttemptFailure(operation, "error", "native_exception", code);
    default:
      return nativeTextAttemptFailure(operation, "error", "unknown", code);
  }
}

function nativeTextAttemptFailure(
  operation: NativeTextAttemptOperation,
  status: NativeTextAttemptStatus,
  detail: NativeTextAttemptDetail,
  platformCode: number | null,
): NativeTextAttemptResult {
  return {
    ok: false,
    operation,
    status,
    detail,
    platform_code: platformCode,
  };
}

function focusProbeStatusFor(code: number): FocusProbeStatus {
  switch (code) {
    case 1:
      return "editable";
    case 0:
      return "no_focus";
    case 2:
      return "not_editable";
    case 3:
      return "untrusted";
    case 4:
      return "blocked_elevated";
    case 5:
      return "secure_input";
    case 6:
      return "timeout";
    default:
      return "unknown";
  }
}

function clipboardKindFor(code: number): ClipboardSnapshotKind {
  if (code === 0) return "empty";
  if (code === 1) return "text";
  return "rich";
}

function clipboardProductOperationResultFor(code: number): ClipboardProductOperationResult {
  if (code === 0) return "ok";
  if (code === -20) return "busy";
  if (code === -21) return "unrestorable";
  return "failed";
}

function utf8(text: string): Buffer {
  return Buffer.from(text, "utf8");
}

const MAC_SHIFT_FLAG = 0x20000;
const MAC_CONTROL_FLAG = 0x40000;
const MAC_ALTERNATE_FLAG = 0x80000;
const MAC_COMMAND_FLAG = 0x100000;
const MAC_FN_FLAG = 0x800000;

const MAC_MODIFIER_FLAG_BY_KEY: Record<number, number> = {
  0x37: MAC_COMMAND_FLAG,
  0x36: MAC_COMMAND_FLAG,
  0x38: MAC_SHIFT_FLAG,
  0x3c: MAC_SHIFT_FLAG,
  0x3a: MAC_ALTERNATE_FLAG,
  0x3d: MAC_ALTERNATE_FLAG,
  0x3b: MAC_CONTROL_FLAG,
  0x3e: MAC_CONTROL_FLAG,
  0x3f: MAC_FN_FLAG,
};

export function normalizeMacModifierEdge(ev: NormalizedKeyEvent): NormalizedKeyEvent {
  const flag = MAC_MODIFIER_FLAG_BY_KEY[ev.key];
  if (flag === undefined) return ev;
  return { ...ev, down: (ev.flags & flag) !== 0 };
}

export function nativeHotkeyEventLoggingEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env["SOTO_LOG_HOTKEY_EVENTS"] === "1";
}

function toAxContext(raw: RawAxStruct): AxContext {
  return {
    full_text: (raw.full_text as string) ?? "",
    selection_start: raw.selection_start,
    selection_end: raw.selection_end,
    before: (raw.before as string) ?? "",
    after: (raw.after as string) ?? "",
    ax_role: (raw.ax_role as string) || null,
    focused_element_id: (raw.focused_element_id as string) || null,
    app_bundle_id: (raw.app_bundle_id as string) || null,
    app_name: (raw.app_name as string) || null,
    window_title: (raw.window_title as string) || null,
    web_url: (raw.web_url as string) || null,
    web_domain: (raw.web_domain as string) || null,
  };
}

export interface AxCapturePort {
  isTrusted(prompt: boolean): boolean;
  probeFocus(): Promise<FocusProbeStatus>;
  captureFocused(): Promise<AxContext | null>;
  windowTitle(): Promise<string | null>;
}

export interface PermissionsPort {
  status(pane: PermissionPane): PermissionStatus;
  request(pane: PermissionPane): PermissionStatus;
  /**
   * Open the OS privacy settings deep-link for `pane`. Returns true if the
   * native layer opened it. Returns false when there is no native entry point
   * (Windows), signalling the caller to fall back to shell.openExternal.
   */
  openSettings(pane: PermissionPane): boolean;
}

/** Installs/removes the global key hook; raw events are normalized for the TS ChordMatcher. */
export interface HotkeyController {
  supportsSuppression: boolean;
  install(onEvent: (ev: NormalizedKeyEvent) => boolean): boolean;
  shutdown(): void;
}

/**
 * Mute/unmute the default output device's mute flag. Best-effort: callers wrap
 * usage so a flaky native layer never breaks the recording flow. Used to silence
 * background media for the duration of a recording without pausing it or changing
 * the volume level — the save/restore policy lives in @soto/core's
 * MediaMuteCoordinator; this port is just the raw get/set.
 */
export interface AudioMutePort {
  isOutputMuted(): boolean;
  /** Write the device mute flag; returns whether the native write succeeded. */
  setOutputMuted(muted: boolean): boolean;
}

export interface NativeFacilities {
  injection: InjectionNativePort;
  ax: AxCapturePort;
  permissions: PermissionsPort;
  hotkey: HotkeyController;
  audioMute: AudioMutePort;
}

export type NativeBridgeLog = (level: "debug" | "warn", message: string) => void;

export function buildFacilities(
  abi: SotoNativeAbi,
  log?: NativeBridgeLog,
): NativeFacilities {
  const attemptResult = (code: number | null): NativeTextAttemptResult =>
    nativeTextAttemptResultForRaw(abi.nativePlatform, "send_paste", code);
  const sendPasteDetailed = (): NativeTextAttemptResult =>
    attemptResult(abi.sendPaste());
  let axInFlight: Promise<unknown> | null = null;
  const runAxSingleFlight = async <T>(
    operation: () => Promise<T>,
    fallback: T,
  ): Promise<T> => {
    if (axInFlight !== null) return fallback;
    const inFlight = operation();
    axInFlight = inFlight;
    try {
      return await inFlight;
    } finally {
      if (axInFlight === inFlight) axInFlight = null;
    }
  };
  // Windows: never run UIA focused-element queries. Instantiating CUIAutomation
  // and calling GetFocusedElement on a Chromium window forces its accessibility
  // tree on and blurs the focused web input — the input loses its caret/DOM
  // focus even though the OS foreground is unchanged, so the subsequent paste
  // lands nowhere. Native app controls tolerate it; web inputs don't. Paste does
  // not need the probe or the AX context (paste gates on app continuity, ADR
  // 0017; the probe is diagnostic-only), so on Windows report "unknown"/null
  // without touching UIA. The window/app NAME still comes from the non-UIA
  // GetWindowText path (ax.windowTitle below).
  const skipUiaFocusedElement = abi.nativePlatform === "win32";
  const probeFocusAsync = (): Promise<FocusProbeStatus> =>
    skipUiaFocusedElement
      ? Promise.resolve("unknown")
      : runAxSingleFlight(
          async () => focusProbeStatusFor(await abi.focusProbeAsync()),
          "timeout",
        );

  const injection: InjectionNativePort = {
    frontmostApp: (): AppInfo => {
      const bundleId = abi.frontmostBundleId();
      return {
        pid: abi.frontmostPid(),
        ...(bundleId !== null ? { bundleId } : {}),
        localizedName: abi.frontmostLocalizedName(),
      };
    },
    frontmostWindowBounds: () => parseWindowBounds(abi.frontmostWindowBoundsRaw()),
    activateApp: (pid) => {
      abi.activateApp(pid);
    },
    probeFocus: () =>
      skipUiaFocusedElement ? "unknown" : focusProbeStatusFor(abi.focusProbe()),
    probeFocusAsync,
    sendPaste: () => sendPasteDetailed().ok,
    sendPasteDetailed,
    clipboardGet: () => abi.clipboardReadText(),
    clipboardSet: (s) => {
      abi.clipboardWriteText(utf8(s));
    },
    clipboardSnapshotKind: () => clipboardKindFor(abi.clipboardSnapshotKind()),
    ...(abi.clipboardCapture && abi.clipboardRestore
      ? {
          clipboardCapture: () => abi.clipboardCapture!() >= 0,
          clipboardRestore: () => abi.clipboardRestore!() === 0,
        }
      : {}),
    clipboardSetTransient: (s) => {
      abi.clipboardSetTransient(utf8(s));
    },
    ...(abi.clipboardPreparePasteText
      ? {
          clipboardPreparePasteText: (s: string) =>
            clipboardProductOperationResultFor(abi.clipboardPreparePasteText!(utf8(s))),
        }
      : {}),
    ...(abi.clipboardRestoreAfterPaste
      ? {
          clipboardRestoreAfterPaste: () =>
            clipboardProductOperationResultFor(abi.clipboardRestoreAfterPaste!()),
        }
      : {}),
    ...(abi.clipboardCopyUserText
      ? {
          clipboardCopyUserText: (s: string) => abi.clipboardCopyUserText!(utf8(s)) === 0,
        }
      : {}),
  };

  const ax: AxCapturePort = {
    isTrusted: (prompt) => abi.axIsTrusted(prompt),
    probeFocus: probeFocusAsync,
    captureFocused: () =>
      skipUiaFocusedElement
        ? Promise.resolve(null)
        : runAxSingleFlight(
            async () => {
              const raw = await abi.axCaptureFocusedAsync();
              return raw ? toAxContext(raw) : null;
            },
            null,
          ),
    windowTitle: () =>
      runAxSingleFlight(
        async () =>
          (await abi.axWindowTitleRawAsync?.()) ??
          (await abi.frontmostWindowTitleRawAsync?.()) ??
          null,
        null,
      ),
  };

  const permissions: PermissionsPort = {
    status: (pane) => permissionStatus(pane, abi.permissionStatusKind(PANE_INDEX[pane])),
    request: (pane) => permissionStatus(pane, abi.requestPermissionKind(PANE_INDEX[pane])),
    // Native entry point is macOS-only (optional on the ABI); when absent the
    // caller (nativeBridgeFromFacilities) is told to fall back to the OS shell.
    openSettings: (pane) =>
      abi.openPermissionSettings?.(PANE_INDEX[pane]) ?? false,
  };

  let handle: unknown = null;
  let drainTimer: ReturnType<typeof setInterval> | null = null;
  const hotkey: HotkeyController = {
    supportsSuppression: false,
    install: (onEvent) => {
      if (handle) return true;
      handle = abi.hookInstall(null, null);
      if (!handle) return false;
      drainTimer = setInterval(() => {
        for (let i = 0; i < 100; i += 1) {
          const rawEvent = abi.nextHookEvent();
          const event =
            rawEvent && process.platform === "darwin"
              ? normalizeMacModifierEdge(rawEvent)
              : rawEvent;
          if (!event) break;
          if (event.droppedCount !== undefined && event.droppedCount > 0) {
            nativeWarn(
              log,
              `[native] hotkey event queue dropped ${event.droppedCount} event(s) before this drain`,
            );
          }
          if (nativeHotkeyEventLoggingEnabled()) {
            nativeDebug(
              log,
              `[native] hotkey event key=${event.key} down=${event.down ? 1 : 0} repeat=${
                event.repeat ? 1 : 0
              } flags=${event.flags}`,
            );
          }
          onEvent(event);
        }
      }, 8);
      if (typeof drainTimer.unref === "function") drainTimer.unref();
      return true;
    },
    shutdown: () => {
      if (drainTimer) clearInterval(drainTimer);
      if (handle) abi.hookShutdown(handle);
      drainTimer = null;
      handle = null;
    },
  };

  const audioMute: AudioMutePort = {
    isOutputMuted: () => abi.audioIsOutputMuted(),
    setOutputMuted: (muted) => abi.audioSetOutputMuted(muted),
  };

  return { injection, ax, permissions, hotkey, audioMute };
}

/**
 * Attempt to load + bind the native library. Returns null (and logs once) when
 * koffi or the platform library is unavailable, so the app keeps running on the
 * JS stub. This is the only place that can throw from the native layer.
 */
export function tryLoadNative(log?: NativeBridgeLog): NativeFacilities | null {
  try {
    return buildFacilities(loadNativeAbi(), log);
  } catch (error) {
    nativeWarn(
      log,
      `[native] koffi bridge unavailable, using stub: ${(error as Error).message}`,
    );
    return null;
  }
}

/**
 * Build the existing NativeBridge surface from the koffi facilities. The
 * permission/accessibility/AX-trust methods map to real native calls;
 * cancel/finish dictation stay no-ops here (they belong to the not-yet-built
 * voice-runtime queue, not the native lib). openPermissionSettings now calls
 * the macOS soto_open_permission_settings entry; on platforms without it
 * (Windows) openSettings returns false and the main wiring should fall back to
 * shell.openExternal.
 */
export function nativeBridgeFromFacilities(f: NativeFacilities): NativeBridge {
  return {
    isAccessibilityTrusted: () => f.ax.isTrusted(false),
    requestAccessibilityPermission: () => f.permissions.request("accessibility").granted,
    permissionStatuses: () => ALL_PANES.map((pane) => f.permissions.status(pane)),
    requestPermission: (pane) => f.permissions.request(pane),
    openPermissionSettings: (pane) => {
      // macOS: soto_open_permission_settings opens the privacy pane natively.
      // If it is unavailable (Windows: no soto_win_* export) openSettings
      // returns false, and the main wiring should fall back to
      // shell.openExternal with the OS settings deep-link.
      return f.permissions.openSettings(pane);
    },
  };
}

function nativeWarn(log: NativeBridgeLog | undefined, message: string): void {
  if (log !== undefined) log("warn", message);
  else console.warn(message);
}

function nativeDebug(log: NativeBridgeLog | undefined, message: string): void {
  if (log !== undefined) log("debug", message);
  else console.debug(message);
}
