import { join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  screen,
  session,
  shell,
  type WebContents,
} from "electron";
import {
  CAPTURE_CONTROL_EVENT,
  HOTKEY_CAPTURE_BEGIN_CHANNEL,
  HOTKEY_CAPTURE_END_CHANNEL,
  HOTKEY_CAPTURE_KEY_EVENT,
  MediaMuteCoordinator,
  NoopPostInsertObserver,
  PERMISSION_UPDATED_EVENT,
  validateOutboundEvent,
  VOICE_RUNTIME_EVENT,
  type CaptureControlEvent,
  type VoiceRuntimeEvent,
} from "@soto/core";
import {
  ALL_COMMANDS,
  CAPSULE_COMMANDS,
  IpcRouter,
  createIpcRegistry,
  type CommandName,
  type WindowKind,
} from "@soto/ipc";
import {
  loadNativeRuntime,
  type NativeBridge,
  type NativeFacilities,
} from "@soto/native-bridge";
import { createHandlers } from "../ipc/handlers.js";
import { openStore, resolveDataDir } from "../db/open.js";
import { repairData as runRepairData } from "../db/repair.js";
import type { SqliteStore } from "../db/store.js";
import { createSafeStorageCrypto } from "../db/crypto.js";
import {
  applyOverlayTheme,
  createMainWindow,
  createCapsuleWindow,
} from "../windows/windows.js";
import { isWindowThemeSource, themeSourceFor } from "../windows/windowChrome.pure.js";
import { CapsuleOverlay, type CapsuleExitIntent } from "../windows/capsuleOverlay.js";
import { showNativeConfirmDialog } from "../shell/confirmDialog.js";
import { enumerateAudioInputDevices } from "../native/micEnumeration.js";
import { installApplicationMenu } from "./menu.js";
import { buildContentSecurityPolicy } from "../shell/security.js";
import { syncLaunchAtLogin } from "../shell/loginItem.js";
import { SessionController } from "../voice/sessionController.js";
import { PermissionGate } from "../native/permissionGate.js";
import { HotkeyService } from "../triggers/hotkeyService.js";
import { makeResolveSession } from "../runtime/sessionRuntime.js";
import { shouldHideMainWindowOnClose } from "../windows/windowLifecycle.pure.js";
import { ClipboardLease } from "../native/clipboardLease.js";
import { DockPresenceController } from "../shell/dockPresence.js";
import { resolveTrayAsset } from "../shell/trayAsset.pure.js";
import { isMainWindowSender } from "../ipc/ipcSender.js";
import { createPlatformInjector } from "../native/platformInjector.js";
import { NativePostInsertObserver } from "../observation/nativePostInsertObserver.js";
import { PostInsertObservationCoordinator } from "../observation/postInsertObservationCoordinator.js";
import {
  createMainLogger,
  type LogLevel,
  type MainLogger,
  type ScopedLogger,
} from "../diagnostics/logger.js";

const IPC_PREFIX = "soto:";
const MENU_ACTION_EVENT = "soto://menu-action";
const WINDOW_THEME_EVENT = "soto://set-theme";
const CAPSULE_OVERLAY_EVENT = "soto://capsule-overlay";
const CAPSULE_SET_INTERACTIVE = "capsule:set-interactive";
const CAPSULE_NOTICE_DISMISSED = "capsule:notice-dismissed";
const CAPSULE_NOTICE_ACTION = "capsule:notice-action";
const PENDING_OBSERVATION_SWEEP_MS = 5 * 60_000;
// Windows: opt into native Fluent overlay scrollbars (the renderer drops its
// custom ::-webkit-scrollbar styling so each OS uses its native overlay).
if (process.platform === "win32") {
  app.commandLine.appendSwitch("enable-features", "FluentOverlayScrollbar");
}
const TRACE_IPC = !app.isPackaged;

function syncLaunchAtLoginSetting(launchAtLogin: boolean): void {
  syncLaunchAtLogin({
    isPackaged: app.isPackaged,
    platform: process.platform,
    launchAtLogin,
    setLoginItemSettings: (settings) => app.setLoginItemSettings(settings),
    log: (detail) => logScope("startup").warn("login_item_update_failed", { detail }),
  });
}

// Channel a renderer uses to learn which window it is (so the main side can
// derive the SenderContext window for authorization). Each window's webContents
// id is mapped at creation time instead of trusting renderer-provided data.
const windowKindByWebContentsId = new Map<number, WindowKind>();

// Live window handles, so the SessionController can emit to the relevant
// windows (main + capsule). Populated at window-creation time.
let mainWindow: BrowserWindow | null = null;
let capsuleWindow: BrowserWindow | null = null;
let isQuitting = false;
let dockPresence: DockPresenceController | null = null;
// Late-bound at buildRuntime() so the capsule overlay's full-screen predicate
// (defined at module load, called only at reveal time) can read the native
// frontmost-window bounds. Null until the runtime is built / when the native
// library is absent (stub).
let nativeFacilities: NativeFacilities | null = null;
let hotkeyServiceForCapture: HotkeyService | null = null;
let diagnosticsLogger: MainLogger | null = null;

function diagnostics(): MainLogger {
  if (diagnosticsLogger === null) {
    diagnosticsLogger = createMainLogger({
      userDataPath: app.getPath("userData"),
      isPackaged: app.isPackaged,
      env: process.env,
    });
  }
  return diagnosticsLogger;
}

function logScope(scope: string): ScopedLogger {
  return diagnostics().scope(scope);
}

function logLine(scope: string, level: LogLevel = "debug"): (message: string) => void {
  return (message) => logScope(scope).line(level, message);
}

/** Send a payload to a window's renderer if it is alive. */
function sendTo(win: BrowserWindow | null, channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) {
    const wc: WebContents = win.webContents;
    if (!wc.isDestroyed()) wc.send(channel, payload);
  }
}

function emitEvent(win: BrowserWindow | null, channel: string, payload: unknown): void {
  if (TRACE_IPC) {
    const check = validateOutboundEvent(channel, payload);
    if (!check.ok) {
      logScope("ipc").error("outbound_invalid", {
        channel,
        error: JSON.stringify(check.error),
      });
    }
  }
  sendTo(win, channel, payload);
}

/**
 * Whether the frontmost app occupies a macOS full-screen Space. Gates the
 * capsule's Dock-dropping activation-policy switch: only full-screen Spaces
 * refuse a regular app's auxiliary window, and there the Dock is already
 * auto-hidden, so the switch is invisible. On the regular desktop this returns
 * false, so the Dock icon never flickers when the capsule appears.
 *
 * Heuristic (no native rebuild): the frontmost window's CG bounds cover an
 * entire display's *full* bounds — a maximized window only fills workArea and
 * leaves the menu-bar strip, so it won't match. Non-darwin / no native bridge
 * → false.
 */
function isFrontmostWindowFullScreen(): boolean {
  if (process.platform !== "darwin") return false;
  const bounds = nativeFacilities?.injection.frontmostWindowBounds?.();
  if (!bounds) return false;
  return screen
    .getAllDisplays()
    .some(
      (d) =>
        Math.abs(bounds.x - d.bounds.x) <= 1 &&
        Math.abs(bounds.y - d.bounds.y) <= 1 &&
        Math.abs(bounds.width - d.bounds.width) <= 1 &&
        Math.abs(bounds.height - d.bounds.height) <= 1,
    );
}

// Owns capsule show/hide positioning and the deferred-hide epoch guard. It
// reports its transient macOS accessory need to DockPresenceController, which
// owns the actual activation policy alongside the persisted hide-icon setting.
const capsuleOverlay = new CapsuleOverlay(
  () => capsuleWindow,
  (event) => sendTo(capsuleWindow, CAPSULE_OVERLAY_EVENT, event),
  isFrontmostWindowFullScreen,
  (active) => dockPresence?.setCapsuleAccessoryNeeded(active),
);

/**
 * Build the media-mute coordinator over the native audio facility. When the
 * native layer is unavailable (stub) the port is a no-op so engage/release are
 * harmless. The coordinator owns the save/restore + no-stacking policy
 * (@soto/core MediaMuteCoordinator); main supplies only the raw get/set.
 */
function createMuteCoordinator(facilities: NativeFacilities | null): MediaMuteCoordinator {
  const port = facilities
    ? {
        isMuted: (): boolean => facilities.audioMute.isOutputMuted(),
        setMuted: (muted: boolean): void => {
          // Surface a native device-mute failure (WASAPI/CoreAudio COM error).
          // Previously discarded at every layer, so a non-functional mute was
          // invisible — this is the one place it becomes observable.
          if (!facilities.audioMute.setOutputMuted(muted)) {
            logScope("native").warn("audio_set_output_muted_failed", { muted });
          }
        },
      }
    : { isMuted: (): boolean => false, setMuted: (): void => {} };
  return new MediaMuteCoordinator(port);
}

/**
 * Build the SessionController, wiring its ports to the live windows + native
 * facilities + store. Runtime-only glue: the two emit callbacks are
 * webContents.send; everything testable lives in SessionController itself.
 */
function buildSessionController(
  store: SqliteStore,
  facilities: NativeFacilities | null,
  bridge: NativeBridge,
  muteCoordinator: MediaMuteCoordinator,
  onStartConsumed: () => void,
  postInsertObserver: PostInsertObservationCoordinator,
): SessionController {
  const noticeClipboard = facilities ? new ClipboardLease(facilities.injection) : null;
  return new SessionController({
    emitVoiceRuntime: (event: VoiceRuntimeEvent) => {
      // level fires ~30Hz and only the capsule consumes it (it drives its meter
      // locally); don't flood the main window with cross-process level events it
      // just drops. Route level to the capsule only; everything else to both.
      if (event.kind === "level") {
        sendTo(capsuleWindow, VOICE_RUNTIME_EVENT, event);
      } else {
        emitEvent(capsuleWindow, VOICE_RUNTIME_EVENT, event);
        emitEvent(mainWindow, VOICE_RUNTIME_EVENT, event);
      }
    },
    sendCaptureControl: (event: CaptureControlEvent) => {
      // The capsule window owns the AudioWorklet capture graph.
      emitEvent(capsuleWindow, CAPTURE_CONTROL_EVENT, event);
    },
    setCapsuleVisible: (
      visible: boolean,
      lingerMs?: number,
      exit: CapsuleExitIntent = "default",
    ) => {
      if (!visible) {
        capsuleOverlay.setVisible(false, lingerMs, exit);
        return;
      }
      // Show on the cursor's display. The old capsule chose the monitor under
      // the cursor and did not refine to the frontmost window afterward.
      capsuleOverlay.setVisible(true);
    },
    setMediaMuted: (muted: boolean) => {
      // Route the controller's WHEN to the native save/restore coordinator. The
      // coordinator already swallows native errors; wrap anyway so a mute hiccup
      // can never break the recording flow.
      try {
        if (muted) muteCoordinator.engage();
        else muteCoordinator.release();
      } catch (error) {
        logScope("native").warn("media_mute_failed", {
          muted,
          error: (error as Error).message,
        });
      }
    },
    frontmostApp: () => facilities?.injection.frontmostApp() ?? null,
    captureAxContext: () => facilities?.ax.captureFocused() ?? null,
    captureWindowTitle: () => facilities?.ax.windowTitle() ?? null,
    probeFocus: () => facilities?.ax.probeFocus() ?? "unknown",
    includeWindowContextInRequests: () =>
      store.getSettings().include_window_context_in_requests,
    modeName: (modeId: string) => store.getMode(modeId)?.name ?? null,
    resolveSession: makeResolveSession(
      store,
      facilities,
      postInsertObserver,
      logLine("voice", "debug"),
    ),
    uuid: () =>
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}-${Math.round(Math.random() * 1e9)}`,
    micDeviceId: () => store.getSettings().microphone_device_id,
    isOverlayLingering: () => capsuleOverlay.hasPendingHide(),
    expediteOverlayHide: () => capsuleOverlay.expediteHide(),
    onStartConsumed,
    copyNoticeText: (text) => {
      noticeClipboard?.copyOnly(text);
    },
    openAccessibilitySettings: () => {
      if (!bridge.openPermissionSettings("accessibility")) {
        void openPermissionSettingsViaShell("accessibility");
      }
    },
    log: logLine("voice", "debug"),
    cancelPostInsertObservation: () => postInsertObserver.cancelActive(),
  });
}

/**
 * Make the global hotkey self-arming behind the macOS Accessibility permission
 * (plan §6 / Phase 3 core). If the dylib is unavailable, hotkeys are inert. If
 * trusted, installs immediately; otherwise prompts and polls every 2 s, arming
 * the hook the instant trust is granted — no manual System Settings editing and
 * no app restart. Emits permission://updated to the windows on each change.
 */
function setupPermissionGate(
  facilities: NativeFacilities | null,
  hotkeyService: HotkeyService | null,
): void {
  if (facilities === null || hotkeyService === null) {
    logScope("native").warn("hotkeys_inert_native_bridge_unavailable");
    return;
  }

  const gate = new PermissionGate({
    isAccessibilityTrusted: () => facilities.ax.isTrusted(false),
    // prompt:true fires AXIsProcessTrustedWithOptions → adds Electron to the
    // Accessibility list + shows the system dialog with an Open-Settings button.
    promptAccessibility: () => {
      facilities.ax.isTrusted(true);
    },
    isMicrophoneGranted: () => facilities.permissions.status("microphone").granted,
    // soto_hook_install returns null (→ install()=false) when the CGEventTap
    // can't be created, which on macOS means Accessibility is not yet granted.
    // The gate retries once trust flips, so a false here is expected pre-grant.
    installHotkeys: () => hotkeyService.install(),
    emitPermission: (event) => {
      emitEvent(mainWindow, PERMISSION_UPDATED_EVENT, event);
      emitEvent(capsuleWindow, PERMISSION_UPDATED_EVENT, event);
    },
    log: logLine("permissions", "info"),
  });

  const step = gate.start();
  if (!step.polling) return;

  const timer = setInterval(() => {
    if (!gate.tick().polling) clearInterval(timer);
  }, 2000);
  // Don't let the poll timer keep the process alive on quit.
  if (typeof timer.unref === "function") timer.unref();
}

interface MainRuntime {
  router: IpcRouter<ReturnType<typeof createIpcRegistry>>;
  store: SqliteStore;
  bridge: NativeBridge;
  facilities: NativeFacilities | null;
  controller: SessionController;
  muteCoordinator: MediaMuteCoordinator;
  hotkeyService: HotkeyService | null;
  dockPresence: DockPresenceController;
}

/**
 * Build the data-repair capability: close the live store (release the Windows
 * file lock), delete the SotoDB, and relaunch. `closeDb` is supplied per entry
 * point — the live store on the renderer path, a no-op when buildRuntime itself
 * failed and no store exists.
 */
function buildRepairData(closeDb: () => void): () => void {
  return () =>
    runRepairData({
      dataDir: resolveDataDir(),
      closeDb,
      relaunch: () => app.relaunch(),
      exit: () => app.exit(0),
      log: (detail) => logScope("startup").warn("repair_data", { detail }),
    });
}

/**
 * Startup failed before any window could load (e.g. openStore threw on a corrupt
 * db). Offer data-repair as a native modal — the only surface available when no
 * renderer is up. No store exists to close, so closeDb is a no-op.
 */
function showStartupFailureDialog(detail: string): void {
  logScope("startup").error("build_runtime_failed", { detail });
  const choice = dialog.showMessageBoxSync({
    type: "error",
    title: "Soto",
    message: "Soto 启动失败",
    detail:
      "无法读取本地数据，可能已损坏。可以清除本地数据库后重启来修复。\n" +
      "这会清空历史、设置与已保存的密钥，但保留其他文件。",
    buttons: ["修复数据并重启", "退出"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (choice === 0) buildRepairData(() => {})();
  else app.exit(1);
}

function buildRuntime(): MainRuntime {
  const store = openStore(createSafeStorageCrypto());
  const swept = store.sweepTimedOutPendingObservations(
    Date.now(),
    PENDING_OBSERVATION_SWEEP_MS,
  );
  if (swept > 0) {
    logScope("observer").info("pending_observations_timed_out", { count: swept });
  }
  const { bridge, facilities } = loadNativeRuntime((level, message) =>
    logScope("native").line(level, message),
  );
  // Expose to the capsule overlay's full-screen predicate (module-level).
  nativeFacilities = facilities;
  const trayAsset = resolveTrayAsset(process.platform);
  const dockPresenceController = new DockPresenceController({
    getMainWindow: () => mainWindow,
    openMainWindow: restoreOrCreateMainWindow,
    quit: () => {
      isQuitting = true;
      app.quit();
    },
    trayIconPath: join(__dirname, "../renderer", trayAsset.file),
    trayIsTemplate: trayAsset.isTemplate,
    labels: { open: "Open Soto", quit: "Quit Soto", tooltip: "Soto" },
    log: logLine("dock", "warn"),
  });
  dockPresence = dockPresenceController;
  const muteCoordinator = createMuteCoordinator(facilities);
  // Late-bound: the controller's chord-dismiss consume must reset the hotkey
  // coordinator (built just below) back to idle, or the next press would read
  // as `complete` and be dropped.
  let hotkeyServiceRef: HotkeyService | null = null;
  const postInsertObserver = new PostInsertObservationCoordinator({
    observer:
      facilities === null
        ? NoopPostInsertObserver
        : new NativePostInsertObserver({
            frontmostApp: () => facilities.injection.frontmostApp(),
            captureAxContext: () => facilities.ax.captureFocused(),
            captureWindowTitle: () => facilities.ax.windowTitle(),
          }),
    writer: store,
    log: logLine("observer", "warn"),
  });
  const controller = buildSessionController(
    store,
    facilities,
    bridge,
    muteCoordinator,
    () => hotkeyServiceRef?.resetSession(),
    postInsertObserver,
  );
  const hotkeyService =
    facilities !== null
      ? new HotkeyService({
          listModes: () => store.listModes(),
          hotkey: facilities.hotkey,
          dispatch: (action) => void controller.dispatch(action),
          log: (level, message) => logScope("hotkey").line(level, message),
        })
      : null;
  hotkeyServiceRef = hotkeyService;
  const handlers = createHandlers(store, bridge, controller, {
    version: app.getVersion(),
    listMicrophoneDevices: () => enumerateAudioInputDevices(mainWindow),
    showConfirmDialog: (opts) => showNativeConfirmDialog(opts, mainWindow),
    // Native facilities present (real dylib) vs null (stub) — feeds AppModel readiness.
    nativeRuntimeAvailable: facilities !== null,
    // A saved mode re-binds the live hotkey chords immediately (no restart).
    onModesChanged: () => hotkeyService?.rebind(),
    onSettingsSaved: (settings) => {
      dockPresenceController.setHideIcon(settings.hide_app_icon);
      syncLaunchAtLoginSetting(settings.launch_at_login);
    },
    openPermissionSettingsFallback: openPermissionSettingsViaShell,
    // Renderer recovery (dead-end "设置命令不可用" screen): the live store is
    // closed to release the file lock before its db files are wiped.
    repairData: buildRepairData(() => store.close()),
  });
  const router = new IpcRouter(createIpcRegistry(handlers));
  return {
    router,
    store,
    bridge,
    facilities,
    controller,
    muteCoordinator,
    hotkeyService,
    dockPresence: dockPresenceController,
  };
}

async function openPermissionSettingsViaShell(
  pane: Parameters<NativeBridge["openPermissionSettings"]>[0],
): Promise<boolean> {
  try {
    await shell.openExternal(permissionSettingsUrl(pane));
    return true;
  } catch {
    return false;
  }
}

function permissionSettingsUrl(
  pane: Parameters<NativeBridge["openPermissionSettings"]>[0],
): string {
  switch (pane) {
    case "microphone":
      return "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";
    case "accessibility":
      return "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";
  }
}

/**
 * Render a dispatch failure's `detail` (zod issues / a thrown handler error)
 * into the rejection message, so the renderer console says WHAT was invalid
 * instead of just "invalid_input". Best-effort: a detail that can't stringify
 * is dropped, never thrown over.
 */
function formatDispatchDetail(detail: unknown): string {
  if (detail === undefined) return "";
  if (detail instanceof Error) return `: ${detail.message}`;
  try {
    return `: ${JSON.stringify(detail)}`;
  } catch {
    return "";
  }
}

function registerIpc(router: MainRuntime["router"]): void {
  for (const command of ALL_COMMANDS) {
    ipcMain.handle(`${IPC_PREFIX}${command}`, async (event, rawArgs) => {
      const window = windowKindByWebContentsId.get(event.sender.id) ?? "main";
      const startedAt = TRACE_IPC ? performance.now() : 0;
      const result = await router.dispatch(command, rawArgs, { window });
      if (TRACE_IPC) {
        logScope("ipc").debug("dispatch", {
          command,
          window,
          durationMs: performance.now() - startedAt,
          ok: result.ok,
        });
      }
      // Surface failures as thrown errors so the renderer's invoke() rejects.
      if (!result.ok) {
        throw new Error(
          `ipc ${command} failed: ${result.error}${formatDispatchDetail(result.detail)}`,
        );
      }
      return result.value;
    });
  }
}

function mainWindowWebContentsId(): number | null {
  if (mainWindow === null || mainWindow.isDestroyed()) return null;
  const wc = mainWindow.webContents;
  return wc.isDestroyed() ? null : wc.id;
}

function assertMainWindowSender(senderId: number): void {
  if (!isMainWindowSender(senderId, mainWindowWebContentsId())) {
    throw new Error("hotkey capture IPC rejected: sender is not the main window");
  }
}

function registerHotkeyCaptureIpc(hotkeyService: HotkeyService | null): void {
  ipcMain.handle(HOTKEY_CAPTURE_BEGIN_CHANNEL, (event) => {
    assertMainWindowSender(event.sender.id);
    return (
      hotkeyService?.beginCapture((key) => {
        sendTo(mainWindow, HOTKEY_CAPTURE_KEY_EVENT, key);
      }) ?? { active: false, suppressing: false, sessionId: 0 }
    );
  });

  ipcMain.handle(HOTKEY_CAPTURE_END_CHANNEL, (event, sessionId) => {
    assertMainWindowSender(event.sender.id);
    if (typeof sessionId !== "number" || !Number.isInteger(sessionId) || sessionId < 0) {
      throw new Error("hotkey capture IPC rejected: invalid session id");
    }
    hotkeyService?.endCapture(sessionId);
  });
}

function installHotkeyCaptureFailsafe(win: BrowserWindow): void {
  const forceEndCapture = () => hotkeyServiceForCapture?.forceEndCapture();
  win.webContents.once("destroyed", forceEndCapture);
  win.webContents.on("render-process-gone", forceEndCapture);
}

function registerWindowThemeSideChannel(): void {
  ipcMain.on(WINDOW_THEME_EVENT, (event, theme) => {
    if (windowKindByWebContentsId.get(event.sender.id) !== "main") return;
    if (!isWindowThemeSource(theme)) return;
    nativeTheme.themeSource = theme;
    applyOverlayTheme(mainWindow);
  });

  nativeTheme.on("updated", () => applyOverlayTheme(mainWindow));
}

function applyCspHeader(): void {
  const contentSecurityPolicy = buildContentSecurityPolicy();
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [contentSecurityPolicy],
      },
    });
  });
}

/**
 * Create the main window and register it (webContents->kind map + closed reset).
 * Centralised so the bootstrap, the macOS `activate`, and the `second-instance`
 * paths all build + track the window identically.
 */
function spawnMainWindow(): BrowserWindow {
  const win = createMainWindow();
  mainWindow = win;
  dockPresence?.refresh();
  windowKindByWebContentsId.set(win.webContents.id, "main");
  installHotkeyCaptureFailsafe(win);
  win.on("close", (event) => {
    if (!shouldHideMainWindowOnClose(process.platform, isQuitting)) return;
    event.preventDefault();
    win.hide();
  });
  win.on("closed", () => {
    mainWindow = null;
  });
  return win;
}

/**
 * Restore the existing main window (un-minimize + focus) or create a fresh one.
 * Keyed on the tracked `mainWindow` handle rather than getAllWindows().length,
 * because the always-alive capsule window is also counted — a count check would
 * never reopen a closed/hidden main window. Used by both `activate` (Dock click)
 * and `second-instance` (relaunch).
 */
function restoreOrCreateMainWindow(): void {
  if (mainWindow !== null && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    if (process.platform === "darwin") app.focus({ steal: true });
    return;
  }
  const win = spawnMainWindow();
  win.show();
  win.focus();
  if (process.platform === "darwin") app.focus({ steal: true });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  logScope("startup").error("single_instance_lock_rejected", {
    detail:
      "another Soto/Electron instance already holds the single-instance lock; quitting",
  });
  app.quit();
} else {
  logScope("startup").info("single_instance_lock_acquired");

  // A second launch (Dock/Finder/Spotlight/CLI) quits before whenReady but must
  // surface the already-running window per requestSingleInstanceLock's contract.
  app.on("second-instance", () => {
    restoreOrCreateMainWindow();
  });

  app.whenReady().then(() => {
    const logger = diagnostics();
    logScope("startup").info("diagnostic_logger_ready", {
      profile: logger.config.profile,
      min_level: logger.config.minLevel,
      file_path: logger.filePath,
    });
    applyCspHeader();
    let runtime: MainRuntime;
    try {
      runtime = buildRuntime();
    } catch (error) {
      // No window can load (the store/db is the failure). Surface a native
      // repair-or-quit modal instead of a silent dead process.
      showStartupFailureDialog(error instanceof Error ? error.message : String(error));
      return;
    }
    syncLaunchAtLoginSetting(runtime.store.getSettings().launch_at_login);
    hotkeyServiceForCapture = runtime.hotkeyService;
    registerIpc(runtime.router);
    registerHotkeyCaptureIpc(runtime.hotkeyService);
    registerWindowThemeSideChannel();

    runtime.dockPresence.setHideIcon(runtime.store.getSettings().hide_app_icon);
    nativeTheme.themeSource = themeSourceFor(runtime.store.getSettings().theme);
    spawnMainWindow();
    runtime.dockPresence.refresh();
    installApplicationMenu({
      showPreferences: () => {
        restoreOrCreateMainWindow();
        sendTo(mainWindow, MENU_ACTION_EVENT, { kind: "preferences" });
      },
    });

    capsuleWindow = createCapsuleWindow();
    windowKindByWebContentsId.set(capsuleWindow.webContents.id, "capsule");
    // focus-diag: the capsule must stay non-activating (focusable:false on
    // Windows). If it ever receives OS focus it has stolen activation from the
    // target app — the start-time focus loss that blurs a web input and breaks
    // paste. This should never fire; if it does, the overlay is still grabbing
    // foreground despite showInactive().
    capsuleWindow.on("focus", () => {
      logScope("native").warn("capsule_window_focused_unexpectedly");
    });
    capsuleWindow.on("closed", () => {
      capsuleWindow = null;
    });

    // Capsule UI: let the Panel's "知道了" button make the click-through overlay
    // momentarily interactive on hover (and back to click-through on leave). Only
    // the capsule window may drive it; the payload must be a boolean.
    ipcMain.on(CAPSULE_SET_INTERACTIVE, (event, interactive) => {
      if (windowKindByWebContentsId.get(event.sender.id) !== "capsule") return;
      if (typeof interactive !== "boolean") return;
      const win = capsuleWindow;
      if (win !== null && !win.isDestroyed()) {
        win.setIgnoreMouseEvents(!interactive, { forward: true });
      }
      // Hovering the Panel also freezes any pending window hide so a notice
      // can't vanish mid-read / mid-click (macOS Notification Center behavior).
      if (interactive) capsuleOverlay.pauseHide();
      else capsuleOverlay.resumeHide();
    });

    // Panel user-dismissed (Got it / strip click): return to click-through and
    // sink the whole overlay promptly. expediteHide is a strict no-op while a
    // recording session is live (no hide pending), so this can never hide an
    // active session. Also clears the controller's attention flag so a later
    // chord press records instead of consuming against a dismissed notice.
    ipcMain.on(CAPSULE_NOTICE_DISMISSED, (event) => {
      if (windowKindByWebContentsId.get(event.sender.id) !== "capsule") return;
      const win = capsuleWindow;
      if (win !== null && !win.isDestroyed()) {
        win.setIgnoreMouseEvents(true, { forward: true });
      }
      capsuleOverlay.expediteHide();
      runtime.controller.noticeDismissed();
    });

    ipcMain.on(CAPSULE_NOTICE_ACTION, (event, id) => {
      if (windowKindByWebContentsId.get(event.sender.id) !== "capsule") return;
      if (id !== "copy_text" && id !== "open_permission_settings") return;
      runtime.controller.noticeAction(id);
    });

    // Light up the global hotkey -> SessionController path (plan §1b/§1c),
    // self-arming behind the Accessibility permission (prompt + poll + install).
    setupPermissionGate(runtime.facilities, runtime.hotkeyService);

    // macOS: clicking the Dock icon restores/focuses the last window (or makes a
    // new one if it was closed) rather than no-op'ing while the capsule is alive.
    app.on("activate", () => {
      restoreOrCreateMainWindow();
    });

    // Safety net: never leave background media muted if the app quits while a
    // recording is still engaged (release is idempotent / a no-op when not muted).
    app.on("before-quit", () => {
      isQuitting = true;
      runtime.hotkeyService?.forceEndCapture();
      runtime.muteCoordinator.release();
      capsuleOverlay.restoreActivationPolicy();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}

// Referenced so the capsule allowlist constant is part of the build graph and
// stays in sync with the preload (which derives its surface from the same set).
void CAPSULE_COMMANDS;
void (ALL_COMMANDS satisfies readonly CommandName[]);
