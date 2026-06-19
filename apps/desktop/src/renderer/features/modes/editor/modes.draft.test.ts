import { describe, expect, it } from "vitest";
import { createModeEditorDraft, buildSaveModeRequest } from "./modes.draft.js";
import type { ModeRecord } from "./modes.ipc.js";

const mode: ModeRecord = {
  id: "rewrite", name: "Rewrite", prompt_body: "x", hotkey: null,
  display_order: 2, built_in: true,
  created_at: 1n, updated_at: 1n,
};

describe("mode draft", () => {
  it("createModeEditorDraft carries editable mode fields", () => {
    expect(createModeEditorDraft(mode)).toMatchObject({
      id: "rewrite",
      name: "Rewrite",
      prompt_body: "x",
      hotkey_enabled: false,
      hotkey_chord: "",
    });
  });

  it("buildSaveModeRequest writes editable fields without command metadata", () => {
    const draft = { ...createModeEditorDraft(mode), name: " Rewrite " };
    const req = buildSaveModeRequest(mode, draft, "steal");
    expect(req.mode.name).toBe("Rewrite");
    expect("is_command" in req.mode).toBe(false);
  });
});
