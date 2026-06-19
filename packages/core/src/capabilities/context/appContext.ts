import type { AxContext } from "../../contract/schema.js";
import {
  DEFAULT_APP_PROFILE_RULES,
  resolveAppProfile,
  type AppProfile,
  type AppProfileRule,
} from "./appProfile.js";
import {
  deriveInputSurfaceKind,
  type InputSurfaceKind,
} from "./inputSurface.js";
import { withDerivedWebDomain } from "./signals.js";
import type {
  ClipboardContextMode,
  TargetContextSnapshot,
} from "./snapshot.js";

export interface AppContextBuildRequest {
  target: TargetContextSnapshot;
  settings: {
    includeWindowContextInRequests: boolean;
    clipboardContextInRequests: ClipboardContextMode;
  };
  appProfileRules?: readonly AppProfileRule[];
}

export interface AppContext {
  snapshotId: string;
  capturedAt: number;
  identity: {
    platform: "macos" | "windows";
    pid: number | null;
    bundleId: string | null;
    executableName: string | null;
    localizedName: string | null;
    windowTitle: string | null;
    webDomain: string | null;
  };
  inputSurface: {
    kind: InputSurfaceKind;
    axRole: string | null;
    selection: TargetContextSnapshot["selection"];
    before: string;
    after: string;
    fullTextWindow: string;
  };
  ambientClipboard: TargetContextSnapshot["ambientClipboard"];
  profile: AppProfile | null;
  projection: {
    includeWindowContextInRequests: boolean;
    clipboardContextInRequests: ClipboardContextMode;
  };
}

function selectionFromTarget(
  target: TargetContextSnapshot,
): TargetContextSnapshot["selection"] {
  if (target.selection.source !== "none" || target.selection.text.length > 0) {
    return target.selection;
  }
  const ax = target.ax;
  if (ax === null || ax.selection_start === ax.selection_end) return target.selection;
  return {
    text: ax.full_text.slice(ax.selection_start, ax.selection_end),
    source: "ax_selection",
    confidence: "high",
  };
}

function clipboardForMode(
  clipboard: TargetContextSnapshot["ambientClipboard"],
  mode: ClipboardContextMode,
): TargetContextSnapshot["ambientClipboard"] {
  if (clipboard === null || mode === "off") return null;
  if (mode === "metadata") {
    return {
      kind: clipboard.kind,
      text: null,
      textTruncated: false,
      changeCount: clipboard.changeCount,
    };
  }
  return clipboard;
}

function appContextIdentityOf(
  target: TargetContextSnapshot,
  ax: AxContext | null,
): AppContext["identity"] {
  const derivedAx = ax === null ? null : withDerivedWebDomain(ax);
  return {
    platform: target.platform,
    pid: target.app.pid,
    bundleId: target.app.bundleId ?? derivedAx?.app_bundle_id ?? null,
    executableName: target.app.executableName,
    localizedName: target.app.localizedName ?? derivedAx?.app_name ?? null,
    windowTitle: target.window.title ?? derivedAx?.window_title ?? null,
    webDomain: derivedAx?.web_domain ?? null,
  };
}

function modelProfileIdentityOf(
  identity: AppContext["identity"],
  axRole: string | null,
  includeWindowContextInRequests: boolean,
) {
  if (includeWindowContextInRequests) {
    return {
      bundleId: identity.bundleId,
      executableName: identity.executableName,
      appName: identity.localizedName,
      windowTitle: identity.windowTitle,
      webDomain: identity.webDomain,
      axRole,
    };
  }
  return {
    bundleId: identity.bundleId,
    executableName: null,
    appName: null,
    windowTitle: null,
    webDomain: null,
    axRole,
  };
}

export function buildAppContext(input: AppContextBuildRequest): AppContext {
  const target = input.target;
  const ax = target.ax === null ? null : withDerivedWebDomain(target.ax);
  const identity = appContextIdentityOf(target, ax);
  const selection = selectionFromTarget(target);
  const axRole = ax?.ax_role ?? target.focusedElement?.axRole ?? null;
  const profile =
    resolveAppProfile(
      modelProfileIdentityOf(
        identity,
        axRole,
        input.settings.includeWindowContextInRequests,
      ),
      input.appProfileRules ?? DEFAULT_APP_PROFILE_RULES,
    ) ?? null;

  return {
    snapshotId: target.id,
    capturedAt: target.capturedAt,
    identity,
    inputSurface: {
      kind: profile?.inputSurface ?? deriveInputSurfaceKind(identity, axRole),
      axRole,
      selection,
      before: ax?.before ?? "",
      after: ax?.after ?? "",
      fullTextWindow: ax?.full_text ?? selection.text,
    },
    ambientClipboard: clipboardForMode(
      target.ambientClipboard,
      input.settings.clipboardContextInRequests,
    ),
    profile,
    projection: {
      includeWindowContextInRequests:
        input.settings.includeWindowContextInRequests,
      clipboardContextInRequests: input.settings.clipboardContextInRequests,
    },
  };
}
