import { describe, expect, it } from "vitest";
import type { Mode } from "@soto/core";

import { modeIdentityTag } from "./modesView";

function mode(partial: Partial<Mode> & Pick<Mode, "id">): Mode {
  const { id, ...rest } = partial;
  const now = 1n;
  return {
    id,
    name: id,
    prompt_body: "",
    hotkey: null,
    display_order: 0,
    built_in: true,
    created_at: now,
    updated_at: now,
    ...rest,
  };
}

describe("modeIdentityTag", () => {
  it("tags default as dictation", () => {
    expect(modeIdentityTag(mode({ id: "default" }))).toEqual({
      labelKey: "modes.identityDictation",
      tone: "ok",
    });
  });

  it("tags translate as translate", () => {
    expect(modeIdentityTag(mode({ id: "translate" }))).toEqual({
      labelKey: "modes.identityTranslate",
      tone: "info",
    });
  });

  it("tags unknown ids as custom", () => {
    expect(modeIdentityTag(mode({ id: "custom" }))).toEqual({
      labelKey: "modes.identityCustom",
      tone: "ok",
    });
  });
});
