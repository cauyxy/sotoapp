import type { Mode } from "@soto/core";

export type ModesTone = "ok" | "info" | "warn" | "neutral";

export interface IdentityTag {
  labelKey: string;
  tone: ModesTone;
}

const VOICE_MODE_TAGS: Record<string, IdentityTag> = {
  default: { labelKey: "modes.identityDictation", tone: "ok" },
  translate: { labelKey: "modes.identityTranslate", tone: "info" },
};

export function modeIdentityTag(mode: Pick<Mode, "id">): IdentityTag {
  return VOICE_MODE_TAGS[mode.id] ?? { labelKey: "modes.identityCustom", tone: "ok" };
}
