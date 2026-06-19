import type { ClipboardSnapshotKind } from "../../contract/schema.js";

export type InjectionTier = "paste";
export type InjectionTargetContinuity =
  | "same_app"
  | "restored_app"
  | "lost_app"
  | "unknown";

export type ManualFallbackReason =
  | "paste_unverified"
  | "paste_send_failed"
  | "clipboard_busy"
  | "clipboard_unrestorable";

export interface TierPlanInput {
  text: string;
  clipboardSnapshotKind: ClipboardSnapshotKind;
}

export interface TierPlan {
  text: string;
  tiers: InjectionTier[];
  manualFallbackReason: ManualFallbackReason | null;
  preferPaste: boolean;
}

export function tierPlanFor(input: TierPlanInput): TierPlan {
  if (input.clipboardSnapshotKind === "rich") {
    return manualFallback(input.text, "clipboard_unrestorable");
  }

  return {
    text: input.text,
    tiers: ["paste"],
    manualFallbackReason: null,
    preferPaste: true,
  };
}

function manualFallback(text: string, reason: ManualFallbackReason): TierPlan {
  return {
    text,
    tiers: [],
    manualFallbackReason: reason,
    preferPaste: false,
  };
}
