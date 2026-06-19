import type {
  AxContext,
  ClipboardSnapshotKind,
  ScreenRectDip,
} from "../../contract/schema.js";

export type TargetContextCaptureReason =
  | "voice_session_start"
  | "post_insert_observation";

export type ClipboardContextMode = "off" | "metadata" | "text";
export type ClipboardContextKind = ClipboardSnapshotKind;

export interface TargetContextCaptureOptions {
  clipboardContextMode: ClipboardContextMode;
}

export interface TargetContextFocusedElement {
  axRole: string | null;
  isSecureTextEntry: boolean | null;
  bounds: ScreenRectDip | null;
  valueSignature: string | null;
}

export interface TargetContextSnapshot {
  id: string;
  capturedAt: number;
  reason: TargetContextCaptureReason;
  platform: "macos" | "windows";
  app: {
    pid: number | null;
    bundleId: string | null;
    localizedName: string | null;
    executableName: string | null;
  };
  window: {
    title: string | null;
  };
  ax: AxContext | null;
  focusedElement: TargetContextFocusedElement | null;
  selection: {
    text: string;
    source: "ax_selection" | "none";
    confidence: "high" | "medium" | "low";
  };
  ambientClipboard: {
    kind: ClipboardContextKind;
    text: string | null;
    textTruncated: boolean;
    changeCount: number | null;
  } | null;
}
