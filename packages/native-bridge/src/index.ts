// NativeBridge — the single seam to OS-native capabilities (plan §2). The real
// implementation will use koffi to call the per-OS C-ABI library (Swift dylib
// facade on macOS, C# AOT DLL on Windows). Until that lands this is a no-op
// stub so the app builds and runs; every method is async-friendly and side-
// effect-free here.

import type {
  PermissionPane,
  PermissionStatus,
} from "@soto/core";
import {
  tryLoadNative,
  nativeBridgeFromFacilities,
  type NativeBridgeLog,
  type NativeFacilities,
} from "./koffiBridge.js";

export type {
  NativeFacilities,
  InjectionNativePort,
  ClipboardProductOperationResult,
  AudioMutePort,
  NativeWindowBounds,
  NativeBridgeLog,
  NativeTextAttemptDetail,
  NativeTextAttemptOperation,
  NativeTextAttemptResult,
  NativeTextAttemptStatus,
} from "./koffiBridge.js";

// Pure native int-code -> status/granted mapping, exported for unit tests (no
// native lib needed — see apps/desktop permissionMapping.test.ts). This is the
// load-bearing translation behind the Windows-mic fix (code 5 -> not_required
// -> granted), which the C# layer cannot assert on a non-Windows host.
export { permissionKindFor, permissionStatus } from "./koffiBridge.js";

// The permission DTOs are canonical in @soto/core (contract/outputs.ts) — they
// cross IPC to the renderer. Re-exported here so native-bridge consumers keep
// importing them from this package's surface.
export type { PermissionPane, PermissionStatus, PermissionStatusKind } from "@soto/core";

export interface NativeBridge {
  isAccessibilityTrusted(): boolean;
  requestAccessibilityPermission(): boolean;
  permissionStatuses(): PermissionStatus[];
  requestPermission(pane: PermissionPane): PermissionStatus;
  openPermissionSettings(pane: PermissionPane): boolean;
}

/**
 * Load the native bridge AND, when the platform library is present, the lower-
 * level facilities (injection port / AX capture / hotkey controller) the
 * SessionController and hotkey wiring need. `facilities` is null when running
 * on the stub. Probes the native layer once so both views share the same
 * loaded library. The returned bridge matches the surface from
 * `createStubNativeBridge()` or `nativeBridgeFromFacilities()`, depending on
 * whether native facilities are available.
 */
export function loadNativeRuntime(log?: NativeBridgeLog): {
  bridge: NativeBridge;
  facilities: NativeFacilities | null;
} {
  const facilities = tryLoadNative(log);
  const bridge = facilities
    ? nativeBridgeFromFacilities(facilities)
    : createStubNativeBridge();
  return { bridge, facilities };
}

/** No-op NativeBridge used until the koffi-backed bridge is implemented. */
export function createStubNativeBridge(): NativeBridge {
  const status = (pane: PermissionPane): PermissionStatus => ({
    pane,
    granted: false,
    status: "unknown",
    label: "Unavailable",
    detail: "Native permission status is unavailable because the native bridge is not loaded.",
  });
  return {
    isAccessibilityTrusted: () => false,
    requestAccessibilityPermission: () => false,
    permissionStatuses: () => [
      status("microphone"),
      status("accessibility"),
    ],
    requestPermission: status,
    openPermissionSettings: () => false,
  };
}
