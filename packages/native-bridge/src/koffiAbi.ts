// koffi FFI declarations for the Soto native C-ABI (plan §2).
//
// Two platforms, two symbol tables:
//   - Windows: `soto_win_*` exports (`[UnmanagedCallersOnly(Cdecl)]`) taken from
//     native/windows/Src/*.cs. The macOS development machine cannot publish the
//     win-x64 NativeAOT DLL, so Windows requires a real Windows host for load
//     verification.
//   - macOS: the domain-split `soto_*` C-ABI exports in native/macos. Simple
//     string reads use caller-owned buffers; AX context strings are one grouped
//     allocation freed with `soto_ax_context_free`; hotkeys are queued natively
//     and drained from the JS event loop instead of calling V8 from the CGEventTap
//     thread.

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// koffi is a native addon and is externalized by electron-vite; load it lazily
// so a missing/incompatible build degrades to the JS stub instead of crashing
// the main process at import time.
type Koffi = typeof import("koffi");

type KoffiLibrary = ReturnType<Koffi["load"]>;
type KoffiBoundFunction = ReturnType<KoffiLibrary["func"]>;

function koffiAsync<T>(fn: KoffiBoundFunction, ...args: unknown[]): Promise<T> {
  return new Promise((resolve, reject) => {
    fn.async(...args, (error: unknown, result: T) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(result);
    });
  });
}

let koffiMod: Koffi | null = null;
function koffi(): Koffi {
  if (koffiMod) return koffiMod;
  const req = createRequire(import.meta.url);
  koffiMod = req("koffi") as Koffi;
  return koffiMod;
}

// Repo-relative location of the freshly `swift build`-ed dylib, so a dev run
// (electron-vite) can load the native bridge without copying it to ~/.soto or
// setting SOTO_NATIVE_LIB. Although this package now lives in
// packages/native-bridge, electron-vite *bundles* it into the app's main, so at
// runtime import.meta.url still resolves to apps/desktop/out/main — the repo
// root remains four levels up (out -> desktop -> apps -> repo). The macOS
// release dir is arch-tagged.
function devMacDylibCandidates(): string[] {
  // import.meta.url works in both CJS-interop and ESM; resolve our own dir.
  let here: string;
  try {
    here = dirname(fileURLToPath(import.meta.url));
  } catch {
    here = process.cwd();
  }
  const repo = join(here, "..", "..", "..", "..");
  const macArch = process.arch === "arm64" ? "arm64-apple-macosx" : "x86_64-apple-macosx";
  const built = join(repo, "native", "macos", ".build", macArch, "release", "libSotoMacNative.dylib");
  return [built];
}

function packagedNativeRoot(): string | null {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return resourcesPath ? join(resourcesPath, "native") : null;
}

/**
 * Resolve the platform native library path. Order: SOTO_NATIVE_LIB override ->
 * bundled Electron resources -> installed ~/.soto/native lib -> (macOS dev)
 * the swift-built .build dylib.
 */
export function nativeLibPath(): string {
  const override = process.env["SOTO_NATIVE_LIB"];
  if (override && override.length > 0) return override;

  const packagedRoot = packagedNativeRoot();
  const root = join(homedir(), ".soto", "native");
  if (process.platform === "win32") {
    const packaged = packagedRoot ? join(packagedRoot, "SotoWinNative.dll") : null;
    if (packaged && existsSync(packaged)) return packaged;
    return join(root, "SotoWinNative.dll");
  }
  if (process.platform === "darwin") {
    const packaged = packagedRoot ? join(packagedRoot, "libSotoMacNative.dylib") : null;
    if (packaged && existsSync(packaged)) return packaged;
    const installed = join(root, "libSotoMacNative.dylib");
    if (existsSync(installed)) return installed;
    const dev = devMacDylibCandidates().find((p) => existsSync(p));
    if (dev) return dev;
    return installed; // let the (eventual) loader report the missing file
  }
  throw new Error(`unsupported platform for native bridge: ${process.platform}`);
}

// --- Shared C types -------------------------------------------------------

/**
 * AX context out-struct. Windows fills AxContextRaw (no bundle id — bundle/app
 * identity comes from frontmost); macOS fills SotoAxContextRaw. Fields are owned
 * `char*` freed as one allocation group by the matching *_ax_*_free entry point.
 */
export interface RawAxStruct {
  full_text: unknown; // char* (decode + free)
  selection_start: number;
  selection_end: number;
  before: unknown; // char*
  after: unknown; // char*
  ax_role: unknown; // char*
  focused_element_id?: unknown; // char*
  app_bundle_id?: unknown; // char* (macOS only)
  app_name?: unknown; // char*
  window_title?: unknown; // char*
  web_url?: unknown; // char*
  web_domain?: unknown; // char*
}

export interface WinHookEventRaw {
  vkCode: number;
  scanCode: number;
  hookFlags: number;
  wParam: number;
  modifiers: number;
  droppedCount: number;
}

/**
 * Raw key-event callback. Windows passes the low-level KBDLLHOOKSTRUCT-derived
 * fields `(vkCode, scanCode, flags, wParam, modifiers, user) -> swallow`; the
 * macOS facade passes the §2.1 shape `(flags, key, down, repeat) -> swallow`.
 * The platform binding normalizes both into NormalizedKeyEvent before handing
 * to the TS ChordMatcher.
 */
export interface NormalizedKeyEvent {
  /** Platform modifier bitset (Windows `modifiers`, macOS `flags`). */
  flags: number;
  /** Virtual-key / key code. */
  key: number;
  /** Platform scan code when supplied by the native hook. */
  scanCode?: number;
  down: boolean;
  repeat: boolean;
  /** Number of native hook events dropped before this event was drained. */
  droppedCount?: number;
}

/** The low-level bound C functions, normalized across platforms. */
export interface SotoNativeAbi {
  nativePlatform: "win32" | "darwin";

  // hotkey
  hookInstall(callback: unknown, userData: unknown): unknown; // returns handle ptr
  hookShutdown(handle: unknown): number;
  nextHookEvent(): NormalizedKeyEvent | null;

  // injection
  focusProbe(): number;
  focusProbeAsync(): Promise<number>;
  sendPaste(): number;

  // clipboard
  clipboardReadText(): string;
  clipboardWriteText(utf8: Buffer): number;
  clipboardSnapshotKind(): number;
  clipboardCapture?(): number;
  clipboardRestore?(): number;
  clipboardSetTransient(utf8: Buffer): number;
  clipboardPreparePasteText?(utf8: Buffer): number;
  clipboardRestoreAfterPaste?(): number;
  clipboardCopyUserText?(utf8: Buffer): number;

  // ax
  axIsTrusted(prompt: boolean): boolean;
  axCaptureFocused(): RawAxStruct | null;
  axCaptureFocusedAsync(): Promise<RawAxStruct | null>;
  axWindowTitleRaw?(): string | null;
  axWindowTitleRawAsync?(): Promise<string | null>;

  // permissions
  permissionStatusKind(pane: number): number;
  requestPermissionKind(pane: number): number;
  /**
   * Open the OS privacy settings deep-link for `pane`. macOS-only at the native
   * level (soto_open_permission_settings -> NSWorkspace.shared.open); returns
   * true on success. Absent on Windows (no soto_win_* export), where the caller
   * falls back to electron shell.openExternal — hence optional.
   */
  openPermissionSettings?(pane: number): boolean;

  // app control
  frontmostPid(): number;
  frontmostLocalizedName(): string;
  frontmostBundleId(): string | null;
  frontmostWindowBoundsRaw(): string | null;
  frontmostWindowTitleRaw?(): string | null;
  frontmostWindowTitleRawAsync?(): Promise<string | null>;
  activateApp(pid: number): number;

  // audio mute — toggles the default OUTPUT device's MUTE FLAG. This never
  // changes the volume level and never pauses playback; unmuting restores the
  // exact prior level. Used to silence background media during a recording.
  // isOutputMuted reads the current flag; setOutputMuted writes it and returns
  // whether the native write succeeded (false = device-mute COM error).
  audioIsOutputMuted(): boolean;
  audioSetOutputMuted(muted: boolean): boolean;
}

/**
 * Load + bind the platform native library. Throws if koffi or the library is
 * unavailable; callers (koffiBridge.tryLoadNative) catch and fall back to the
 * JS stub. The two branches declare the platform-specific symbols and return a
 * normalized SotoNativeAbi.
 */
export function loadNativeAbi(libPath = nativeLibPath()): SotoNativeAbi {
  const k = koffi();
  const lib = k.load(libPath);

  // C-string helpers. String-returning entry points hand back a raw `char*`
  // that the native side allocated (macOS: CAbiSupport.cString; Windows:
  // StringInterop.AllocUtf8). `str` in Koffi is a function-signature type; when
  // decoding an already-returned pointer, use decode.string(ptr). decode(ptr,
  // "str") would treat the bytes at ptr as another char* and can segfault.
  const decodeCString = (ptr: unknown): string => {
    if (!ptr) return "";
    return k.decode.string(ptr);
  };

  // Decode and then hand the original pointer back to the platform free fn
  // (Windows: soto_win_free_string). macOS no longer exposes per-string owned
  // returns for simple reads; AX out-struct fields are group-freed instead.
  const takeOwnedString = (ptr: unknown, free: (p: unknown) => void): string => {
    if (!ptr) return "";
    try {
      return decodeCString(ptr);
    } finally {
      free(ptr);
    }
  };

  if (process.platform === "win32") {
    return loadWindows(k, lib, decodeCString, takeOwnedString);
  }
  if (process.platform === "darwin") {
    return loadMac(k, lib, decodeCString);
  }
  throw new Error(`unsupported platform for native bridge: ${process.platform}`);
}

/**
 * Native soto_*_audio_set_output_muted returns 0 on success, -1 on error. Map it
 * to a success boolean so the device-mute write result is no longer discarded —
 * a failed COM SetMute (WASAPI/CoreAudio) used to be completely silent. Fail
 * closed: only 0 counts as success.
 */
export function muteWriteSucceeded(nativeResult: number): boolean {
  return nativeResult === 0;
}

export const WIN_SIGNATURES = {
  hook_install: "void *soto_win_hook_install(void *callback, void *userData)",
  hook_shutdown: "int soto_win_hook_shutdown(void *handle)",
  hook_next_event: "int soto_win_hook_next_event(_Out_ WinHookEventRaw *outEvent)",
  focus_probe: "int soto_win_focus_probe()",
  send_paste: "int soto_win_send_paste()",
  clipboard_read_text: "void *soto_win_clipboard_read_text()",
  clipboard_write_text: "int soto_win_clipboard_write_text(uint8_t *text, size_t len)",
  clipboard_snapshot_kind: "int soto_win_clipboard_snapshot_kind()",
  clipboard_capture: "int soto_win_clipboard_capture()",
  clipboard_restore: "int soto_win_clipboard_restore()",
  clipboard_set_excluded: "int soto_win_clipboard_set_excluded(uint8_t *text, size_t len)",
  ax_is_trusted: "int soto_win_ax_is_trusted(uint8_t prompt)",
  ax_capture_focused: "int soto_win_ax_capture_focused(_Out_ AxContextRaw *outCtx)",
  ax_context_free: "void soto_win_ax_context_free(AxContextRaw *ctx)",
  frontmost_pid: "int soto_win_frontmost_pid()",
  frontmost_localized_name: "void *soto_win_frontmost_localized_name()",
  frontmost_window_title: "void *soto_win_frontmost_window_title()",
  frontmost_window_bounds: "void *soto_win_frontmost_window_bounds()",
  activate_app: "int soto_win_activate_app(int pid)",
  permission_status_kind: "int soto_win_permission_status_kind(int pane)",
  request_permission: "int soto_win_request_permission(int pane)",
  audio_is_output_muted: "int soto_win_audio_is_output_muted()",
  audio_set_output_muted: "int soto_win_audio_set_output_muted(int muted)",
  free_string: "void soto_win_free_string(void *ptr)",
} as const;

export const MAC_SIGNATURES = {
  hook_install: "void *soto_hook_install(void *callback, void *userData)",
  hook_shutdown: "int soto_hook_shutdown(void *handle)",
  hook_next_event: "int soto_hook_next_event(_Out_ SotoHookEventRaw *outEvent)",
  focus_probe: "int soto_focus_probe()",
  send_paste: "int soto_send_paste()",
  clipboard_prepare_paste_text: "int soto_clipboard_prepare_paste_text(uint8_t *text, size_t len)",
  clipboard_restore_after_paste: "int soto_clipboard_restore_after_paste()",
  clipboard_copy_user_text: "int soto_clipboard_copy_user_text(uint8_t *text, size_t len)",
  ax_is_trusted: "int soto_ax_is_trusted(int prompt)",
  ax_capture_focused: "int soto_ax_capture_focused(_Out_ SotoAxContextRaw *outCtx)",
  ax_context_free: "int soto_ax_context_free(SotoAxContextRaw *ctx)",
  window_title: "int soto_window_title(_Out_ uint8_t *buffer, size_t bufferLen, _Out_ size_t *requiredLen)",
  permission_status_kind: "int soto_permission_status_kind(int pane)",
  request_permission: "int soto_request_permission(int pane)",
  open_permission_settings: "int soto_open_permission_settings(int pane)",
  app_frontmost: "int soto_app_frontmost(_Out_ SotoAppInfoRaw *outApp, _Out_ uint8_t *buffer, size_t bufferLen, _Out_ size_t *requiredLen)",
  app_frontmost_window_bounds: "int soto_app_frontmost_window_bounds(_Out_ SotoRectRaw *outRect)",
  app_activate: "int soto_app_activate(int pid)",
  audio_is_output_muted: "int soto_audio_is_output_muted()",
  audio_set_output_muted: "int soto_audio_set_output_muted(int muted)",
} as const;

// --- Windows: SotoWinNative.dll (soto_win_*) ------------------------------

export function normalizeWindowsHookEventRaw(raw: WinHookEventRaw): NormalizedKeyEvent {
  return {
    flags: raw.modifiers,
    key: raw.vkCode,
    scanCode: raw.scanCode,
    down: raw.wParam === 0x0100 || raw.wParam === 0x0104,
    repeat: false,
    droppedCount: raw.droppedCount,
  };
}

function loadWindows(
  k: Koffi,
  lib: KoffiLibrary,
  decodeCString: (ptr: unknown) => string,
  takeOwnedString: (ptr: unknown, free: (p: unknown) => void) => string,
): SotoNativeAbi {
  const optionalFunc = (signature: string): ReturnType<KoffiLibrary["func"]> | null => {
    try {
      return lib.func(signature);
    } catch {
      return null;
    }
  };

  k.struct("AxContextRaw", {
    full_text: "void *",
    selection_start: "uint32",
    selection_end: "uint32",
    before: "void *",
    after: "void *",
    ax_role: "void *",
    focused_element_id: "void *",
  });
  k.struct("WinHookEventRaw", {
    vkCode: "uint32",
    scanCode: "uint32",
    hookFlags: "uint32",
    wParam: "size_t",
    modifiers: "uint32",
    droppedCount: "uint32",
  });

  const fns = {
    hook_install: lib.func(WIN_SIGNATURES.hook_install),
    hook_shutdown: lib.func(WIN_SIGNATURES.hook_shutdown),
    hook_next_event: lib.func(WIN_SIGNATURES.hook_next_event),
    focus_probe: optionalFunc(WIN_SIGNATURES.focus_probe),
    send_paste: lib.func(WIN_SIGNATURES.send_paste),
    clipboard_read_text: lib.func(WIN_SIGNATURES.clipboard_read_text),
    clipboard_write_text: lib.func(WIN_SIGNATURES.clipboard_write_text),
    clipboard_snapshot_kind: optionalFunc(WIN_SIGNATURES.clipboard_snapshot_kind),
    clipboard_capture: optionalFunc(WIN_SIGNATURES.clipboard_capture),
    clipboard_restore: optionalFunc(WIN_SIGNATURES.clipboard_restore),
    clipboard_set_excluded: optionalFunc(WIN_SIGNATURES.clipboard_set_excluded),
    ax_is_trusted: lib.func(WIN_SIGNATURES.ax_is_trusted),
    ax_capture_focused: lib.func(WIN_SIGNATURES.ax_capture_focused),
    ax_context_free: lib.func(WIN_SIGNATURES.ax_context_free),
    frontmost_pid: lib.func(WIN_SIGNATURES.frontmost_pid),
    frontmost_localized_name: lib.func(WIN_SIGNATURES.frontmost_localized_name),
    frontmost_window_title: optionalFunc(WIN_SIGNATURES.frontmost_window_title),
    frontmost_window_bounds: optionalFunc(WIN_SIGNATURES.frontmost_window_bounds),
    activate_app: lib.func(WIN_SIGNATURES.activate_app),
    permission_status_kind: lib.func(WIN_SIGNATURES.permission_status_kind),
    request_permission: lib.func(WIN_SIGNATURES.request_permission),
    audio_is_output_muted: lib.func(WIN_SIGNATURES.audio_is_output_muted),
    audio_set_output_muted: lib.func(WIN_SIGNATURES.audio_set_output_muted),
    free_string: lib.func(WIN_SIGNATURES.free_string),
  };

  const freeString = (p: unknown): void => fns.free_string(p);
  const clipboardSnapshotApi =
    fns.clipboard_capture && fns.clipboard_restore
      ? {
          clipboardCapture: () => fns.clipboard_capture!() as number,
          clipboardRestore: () => fns.clipboard_restore!() as number,
        }
      : {};
  const decodeAxCaptureOut = (out: Record<string, unknown>): RawAxStruct => ({
    full_text: decodeCString(out["full_text"]),
    selection_start: out["selection_start"] as number,
    selection_end: out["selection_end"] as number,
    before: decodeCString(out["before"]),
    after: decodeCString(out["after"]),
    ax_role: decodeCString(out["ax_role"]),
    focused_element_id: decodeCString(out["focused_element_id"]),
  });
  const freeAxCaptureOut = (out: Record<string, unknown>): void => {
    try {
      fns.ax_context_free(out);
    } catch {
      /* decoded strings are already copied into JS */
    }
  };

  return {
    nativePlatform: "win32",
    hookInstall: (cb, user) => fns.hook_install(cb, user),
    hookShutdown: (handle) => fns.hook_shutdown(handle) as number,
    nextHookEvent: () => {
      const out: Record<string, unknown> = {};
      const rc = fns.hook_next_event(out) as number;
      if (rc !== 1) return null;
      return normalizeWindowsHookEventRaw({
        vkCode: Number(out["vkCode"]),
        scanCode: Number(out["scanCode"]),
        hookFlags: Number(out["hookFlags"]),
        wParam: Number(out["wParam"]),
        modifiers: Number(out["modifiers"]),
        droppedCount: Number(out["droppedCount"]),
      });
    },
    focusProbe: () => (fns.focus_probe ? fns.focus_probe() as number : -100),
    focusProbeAsync: () =>
      fns.focus_probe ? koffiAsync<number>(fns.focus_probe) : Promise.resolve(-100),
    sendPaste: () => fns.send_paste() as number,

    clipboardReadText: () => takeOwnedString(fns.clipboard_read_text(), freeString),
    clipboardWriteText: (utf8) => fns.clipboard_write_text(utf8, utf8.byteLength) as number,
    clipboardSnapshotKind: () =>
      fns.clipboard_snapshot_kind && fns.clipboard_capture && fns.clipboard_restore
        ? fns.clipboard_snapshot_kind() as number
        : 2,
    ...clipboardSnapshotApi,
    clipboardSetTransient: (utf8) =>
      fns.clipboard_set_excluded
        ? fns.clipboard_set_excluded(utf8, utf8.byteLength) as number
        : fns.clipboard_write_text(utf8, utf8.byteLength) as number,

    axIsTrusted: (prompt) => (fns.ax_is_trusted(prompt ? 1 : 0) as number) !== 0,
    axCaptureFocused: () => {
      const out: Record<string, unknown> = {};
      const rc = fns.ax_capture_focused(out) as number;
      if (rc !== 1) return null;
      // The Windows AX struct owns all string fields as one allocation group.
      // Free the struct once after decoding; do not free fields individually.
      try {
        return decodeAxCaptureOut(out);
      } finally {
        freeAxCaptureOut(out);
      }
    },
    axCaptureFocusedAsync: async () => {
      const out: Record<string, unknown> = {};
      const rc = await koffiAsync<number>(fns.ax_capture_focused, out);
      if (rc !== 1) return null;
      try {
        return decodeAxCaptureOut(out);
      } finally {
        freeAxCaptureOut(out);
      }
    },
    permissionStatusKind: (pane) => fns.permission_status_kind(pane) as number,
    requestPermissionKind: (pane) => fns.request_permission(pane) as number,

    frontmostPid: () => fns.frontmost_pid() as number,
    frontmostLocalizedName: () =>
      takeOwnedString(fns.frontmost_localized_name(), freeString),
    frontmostBundleId: () => null, // Windows has no bundle id; identity via pid
    frontmostWindowBoundsRaw: () => {
      const raw = fns.frontmost_window_bounds
        ? takeOwnedString(fns.frontmost_window_bounds(), freeString)
        : "";
      return raw.length > 0 ? raw : null;
    },
    frontmostWindowTitleRaw: () => {
      const ptr = fns.frontmost_window_title?.();
      return ptr ? takeOwnedString(ptr, freeString) : null;
    },
    frontmostWindowTitleRawAsync: async () => {
      if (!fns.frontmost_window_title) return null;
      const ptr = await koffiAsync<unknown>(fns.frontmost_window_title);
      return ptr ? takeOwnedString(ptr, freeString) : null;
    },
    activateApp: (pid) => fns.activate_app(pid) as number,

    // soto_win_audio_is_output_muted: 1 muted / 0 unmuted / -1 error.
    audioIsOutputMuted: () => (fns.audio_is_output_muted() as number) === 1,
    audioSetOutputMuted: (muted) =>
      muteWriteSucceeded(fns.audio_set_output_muted(muted ? 1 : 0) as number),
  };
}

// --- macOS: libSotoMacNative via domain-split soto_* exports --------------

interface MacFrontmostApp {
  pid: number;
  localizedName: string;
  bundleId: string | null;
}

function loadMac(
  k: Koffi,
  lib: KoffiLibrary,
  decodeCString: (ptr: unknown) => string,
): SotoNativeAbi {
  k.struct("SotoHookEventRaw", {
    flags: "uint64",
    key: "uint32",
    scanCode: "uint32",
    down: "uint8",
    repeat: "uint8",
    droppedCount: "uint32",
  });
  k.struct("SotoAxContextRaw", {
    selection_start: "uint32",
    selection_end: "uint32",
    full_text: "void *",
    before: "void *",
    after: "void *",
    ax_role: "void *",
    focused_element_id: "void *",
  });
  k.struct("SotoAppInfoRaw", {
    pid: "int32",
    name_len: "uint32",
    bundle_len: "uint32",
  });
  k.struct("SotoRectRaw", {
    x: "double",
    y: "double",
    width: "double",
    height: "double",
  });

  const fns = {
    hook_install: lib.func(MAC_SIGNATURES.hook_install),
    hook_shutdown: lib.func(MAC_SIGNATURES.hook_shutdown),
    hook_next_event: lib.func(MAC_SIGNATURES.hook_next_event),
    focus_probe: lib.func(MAC_SIGNATURES.focus_probe),
    send_paste: lib.func(MAC_SIGNATURES.send_paste),
    clipboard_prepare_paste_text: lib.func(MAC_SIGNATURES.clipboard_prepare_paste_text),
    clipboard_restore_after_paste: lib.func(MAC_SIGNATURES.clipboard_restore_after_paste),
    clipboard_copy_user_text: lib.func(MAC_SIGNATURES.clipboard_copy_user_text),
    ax_is_trusted: lib.func(MAC_SIGNATURES.ax_is_trusted),
    ax_capture_focused: lib.func(MAC_SIGNATURES.ax_capture_focused),
    ax_context_free: lib.func(MAC_SIGNATURES.ax_context_free),
    window_title: lib.func(MAC_SIGNATURES.window_title),
    permission_status_kind: lib.func(MAC_SIGNATURES.permission_status_kind),
    request_permission: lib.func(MAC_SIGNATURES.request_permission),
    // soto_open_permission_settings(pane) -> 0 success / -1 failure.
    open_permission_settings: lib.func(MAC_SIGNATURES.open_permission_settings),
    app_frontmost: lib.func(MAC_SIGNATURES.app_frontmost),
    app_frontmost_window_bounds: lib.func(MAC_SIGNATURES.app_frontmost_window_bounds),
    app_activate: lib.func(MAC_SIGNATURES.app_activate),
    audio_is_output_muted: lib.func(MAC_SIGNATURES.audio_is_output_muted),
    audio_set_output_muted: lib.func(MAC_SIGNATURES.audio_set_output_muted),
  };

  const readSize = (out: unknown[]): number => {
    const value = out[0];
    if (typeof value === "bigint") return Number(value);
    if (typeof value === "number") return value;
    return 0;
  };

  const readBuffered = (fn: KoffiBoundFunction, initialBytes = 512): string | null => {
    let required: unknown[] = [0];
    let buffer = Buffer.alloc(Math.max(1, initialBytes));
    let rc = fn(buffer, buffer.byteLength, required) as number;
    if (rc < 0) {
      const needed = readSize(required);
      if (needed < 0 || needed > 16 * 1024 * 1024) return null;
      buffer = Buffer.alloc(Math.max(1, needed));
      required = [0];
      rc = fn(buffer, buffer.byteLength, required) as number;
    }
    if (rc < 0) return null;
    return buffer.subarray(0, rc).toString("utf8");
  };

  const readBufferedAsync = async (
    fn: KoffiBoundFunction,
    initialBytes = 512,
  ): Promise<string | null> => {
    let required: unknown[] = [0];
    let buffer = Buffer.alloc(Math.max(1, initialBytes));
    let rc = await koffiAsync<number>(fn, buffer, buffer.byteLength, required);
    if (rc < 0) {
      const needed = readSize(required);
      if (needed < 0 || needed > 16 * 1024 * 1024) return null;
      buffer = Buffer.alloc(Math.max(1, needed));
      required = [0];
      rc = await koffiAsync<number>(fn, buffer, buffer.byteLength, required);
    }
    if (rc < 0) return null;
    return buffer.subarray(0, rc).toString("utf8");
  };

  const readFrontmostApp = (): MacFrontmostApp => {
    let out: Record<string, unknown> = {};
    let required: unknown[] = [0];
    let buffer = Buffer.alloc(512);
    let rc = fns.app_frontmost(out, buffer, buffer.byteLength, required) as number;
    if (rc < 0) {
      const needed = readSize(required);
      if (needed > 0 && needed <= 16 * 1024 * 1024) {
        out = {};
        required = [0];
        buffer = Buffer.alloc(Math.max(1, needed));
        rc = fns.app_frontmost(out, buffer, buffer.byteLength, required) as number;
      }
    }
    if (rc < 0) {
      return { pid: Number(out["pid"] ?? -1), localizedName: "", bundleId: null };
    }

    const nameLen = Number(out["name_len"] ?? 0);
    const bundleLen = Number(out["bundle_len"] ?? 0);
    const pid = Number(out["pid"] ?? -1);
    const name = buffer.subarray(0, nameLen).toString("utf8");
    const bundle = buffer.subarray(nameLen, nameLen + bundleLen).toString("utf8");
    return { pid, localizedName: name, bundleId: bundle.length > 0 ? bundle : null };
  };

  const decodeAxCaptureOut = (out: Record<string, unknown>): RawAxStruct => ({
    full_text: decodeCString(out["full_text"]),
    selection_start: out["selection_start"] as number,
    selection_end: out["selection_end"] as number,
    before: decodeCString(out["before"]),
    after: decodeCString(out["after"]),
    ax_role: decodeCString(out["ax_role"]),
    focused_element_id: decodeCString(out["focused_element_id"]),
  });

  const freeAxCaptureOut = (out: Record<string, unknown>): void => {
    try {
      fns.ax_context_free(out);
    } catch {
      /* decoded strings are already copied into JS */
    }
  };

  return {
    nativePlatform: "darwin",
    hookInstall: (cb, user) => fns.hook_install(cb, user),
    hookShutdown: (handle) => fns.hook_shutdown(handle) as number,
    nextHookEvent: () => {
      const out: Record<string, unknown> = {};
      const rc = fns.hook_next_event(out) as number;
      if (rc !== 1) return null;
      const flags = Number(out["flags"]);
      const key = Number(out["key"]);
      const down = Number(out["down"]);
      const repeat = Number(out["repeat"]);
      const scanCode = Number(out["scanCode"] ?? 0);
      const droppedCount = Number(out["droppedCount"] ?? 0);
      return {
        flags,
        key,
        scanCode,
        down: down !== 0,
        repeat: repeat !== 0,
        droppedCount,
      };
    },
    focusProbe: () => fns.focus_probe() as number,
    focusProbeAsync: () => koffiAsync<number>(fns.focus_probe),
    sendPaste: () => fns.send_paste() as number,

    clipboardReadText: () => "",
    clipboardWriteText: (utf8) =>
      fns.clipboard_copy_user_text(utf8, utf8.byteLength) as number,
    clipboardSnapshotKind: () => 1,
    clipboardSetTransient: (utf8) =>
      fns.clipboard_prepare_paste_text(utf8, utf8.byteLength) as number,
    clipboardPreparePasteText: (utf8) =>
      fns.clipboard_prepare_paste_text(utf8, utf8.byteLength) as number,
    clipboardRestoreAfterPaste: () => fns.clipboard_restore_after_paste() as number,
    clipboardCopyUserText: (utf8) =>
      fns.clipboard_copy_user_text(utf8, utf8.byteLength) as number,

    axIsTrusted: (prompt) => (fns.ax_is_trusted(prompt ? 1 : 0) as number) !== 0,
    axCaptureFocused: () => {
      const out: Record<string, unknown> = {};
      const rc = fns.ax_capture_focused(out) as number;
      if (rc !== 1) return null;
      try {
        return decodeAxCaptureOut(out);
      } finally {
        freeAxCaptureOut(out);
      }
    },
    axCaptureFocusedAsync: async () => {
      const out: Record<string, unknown> = {};
      const rc = await koffiAsync<number>(fns.ax_capture_focused, out);
      if (rc !== 1) return null;
      try {
        return decodeAxCaptureOut(out);
      } finally {
        freeAxCaptureOut(out);
      }
    },
    axWindowTitleRaw: () => {
      const raw = readBuffered(fns.window_title);
      return raw && raw.length > 0 ? raw : null;
    },
    axWindowTitleRawAsync: async () => {
      const raw = await readBufferedAsync(fns.window_title);
      return raw && raw.length > 0 ? raw : null;
    },
    permissionStatusKind: (pane) => fns.permission_status_kind(pane) as number,
    requestPermissionKind: (pane) => fns.request_permission(pane) as number,
    // 0 = settings opened, -1 = unknown pane / NSWorkspace open failed.
    openPermissionSettings: (pane) => (fns.open_permission_settings(pane) as number) === 0,

    frontmostPid: () => readFrontmostApp().pid,
    frontmostLocalizedName: () => readFrontmostApp().localizedName,
    frontmostBundleId: () => readFrontmostApp().bundleId,
    frontmostWindowBoundsRaw: () => {
      const out: Record<string, unknown> = {};
      const rc = fns.app_frontmost_window_bounds(out) as number;
      if (rc !== 1) return null;
      const x = Number(out["x"]);
      const y = Number(out["y"]);
      const width = Number(out["width"]);
      const height = Number(out["height"]);
      if (![x, y, width, height].every((value) => Number.isFinite(value))) return null;
      return `${x},${y},${width},${height}`;
    },
    frontmostWindowTitleRaw: () => {
      const raw = readBuffered(fns.window_title);
      return raw && raw.length > 0 ? raw : null;
    },
    frontmostWindowTitleRawAsync: async () => {
      const raw = await readBufferedAsync(fns.window_title);
      return raw && raw.length > 0 ? raw : null;
    },
    activateApp: (pid) => fns.app_activate(pid) as number,

    // soto_audio_is_output_muted: 1 muted / 0 unmuted / -1 error.
    audioIsOutputMuted: () => (fns.audio_is_output_muted() as number) === 1,
    audioSetOutputMuted: (muted) =>
      muteWriteSucceeded(fns.audio_set_output_muted(muted ? 1 : 0) as number),
  };
}
