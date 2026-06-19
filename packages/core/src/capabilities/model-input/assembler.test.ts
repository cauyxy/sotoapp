import { describe, expect, it } from "vitest";
import type { AxContext } from "../../contract/schema.js";
import { buildAppContext, type TargetContextSnapshot } from "../context/context.js";
import { assembleModelInput } from "./assembler.js";

const baseAx: AxContext = {
  full_text: "hello selected world",
  selection_start: 6,
  selection_end: 14,
  before: "hello ",
  after: " world",
  ax_role: "AXTextArea",
  app_bundle_id: "com.example.Writer",
  app_name: "Writer",
  window_title: "Draft",
  web_url: "https://docs.google.com/document/d/1",
  web_domain: null,
};

function target(overrides: Partial<TargetContextSnapshot> = {}): TargetContextSnapshot {
  return {
    id: "target.1",
    capturedAt: 1_700_000_000_000,
    reason: "voice_session_start",
    platform: "macos",
    app: {
      pid: 42,
      bundleId: "com.example.Writer",
      localizedName: "Writer",
      executableName: "Writer",
    },
    window: { title: "Draft" },
    ax: baseAx,
    focusedElement: null,
    selection: { text: "", source: "none", confidence: "low" },
    ambientClipboard: {
      kind: "text",
      text: "ambient clipboard",
      textTruncated: false,
      changeCount: 7,
    },
    ...overrides,
  };
}

describe("assembleModelInput", () => {
  it("assembles dictation model input with a fixed provider-neutral context block order", () => {
    const hotwords = ["Soto", "Codex"];
    const input = assembleModelInput({
      intent: "dictation",
      modeId: "default",
      modePrompt: "Please transcribe",
      recording: {
        audioB64: "audio",
        audioFormat: "wav",
        durationMs: 1_200,
        peak: 0.25,
      },
      appContext: buildAppContext({
        target: target(),
        settings: {
          includeWindowContextInRequests: true,
          clipboardContextInRequests: "metadata",
        },
        appProfileRules: [
          {
            match: { domains: ["docs.google.com"] },
            profile: {
              registerHint: "formal",
              punctuationStyle: "standard",
            },
          },
        ],
      }),
      hotwords,
      now: 1_700_000_000_001,
    });

    hotwords.push("mutated");

    expect(input).toMatchObject({
      intent: "dictation",
      mode: { id: "default", prompt: "Please transcribe" },
      audio: { audioB64: "audio", audioFormat: "wav" },
      clipboardContext: {
        kind: "metadata",
        clipboardKind: "text",
        changeCount: 7,
      },
    });
    expect(input.hotwords).toEqual(["Soto", "Codex"]);
    expect(input.contextBlocks.map((block) => block.kind)).toEqual([
      "base_instruction",
      "app_profile",
      "hotwords",
      "target_context",
      "clipboard_context",
      "user_message",
    ]);
    expect(input.contextBlocks[3]).toMatchObject({
      kind: "target_context",
      axContext: {
        app_name: "Writer",
        window_title: "Draft",
        web_domain: "docs.google.com",
      },
    });
    expect(input.contextBlocks.at(-1)).toEqual({
      kind: "user_message",
      message: { kind: "audio", audio: { audioB64: "audio", audioFormat: "wav" } },
    });
  });

  it("applies privacy and clipboard projection before building dictation model blocks", () => {
    const input = assembleModelInput({
      intent: "dictation",
      modeId: "default",
      modePrompt: "Transcribe",
      recording: {
        audioB64: "audio",
        audioFormat: "wav",
        durationMs: 1_200,
        peak: 0.25,
      },
      appContext: buildAppContext({
        target: target({
          app: {
            pid: 42,
            bundleId: null,
            localizedName: "Private Writer",
            executableName: "Private Writer",
          },
          window: { title: "Secret Docs" },
          ax: {
            ...baseAx,
            app_bundle_id: null,
            app_name: "Private Writer",
            window_title: "Secret Docs",
            web_url: "https://docs.example.com/doc",
            web_domain: null,
          },
        }),
        settings: {
          includeWindowContextInRequests: false,
          clipboardContextInRequests: "off",
        },
        appProfileRules: [
          {
            match: { domains: ["docs.example.com"] },
            profile: { registerHint: "formal" },
          },
        ],
      }),
      hotwords: ["Soto"],
      now: 1_700_000_000_001,
    });

    expect(input.clipboardContext).toBeNull();
    expect(input.contextBlocks.map((block) => block.kind)).toEqual([
      "base_instruction",
      "hotwords",
      "target_context",
      "user_message",
    ]);
    expect(input.contextBlocks[2]).toMatchObject({
      kind: "target_context",
      axContext: {
        app_name: null,
        window_title: null,
        web_url: null,
        web_domain: null,
      },
    });
    expect(input.contextBlocks).not.toContainEqual({
      kind: "app_profile",
      profile: { registerHint: "formal" },
    });
  });

  it("rejects dictation input without recording", () => {
    const appContext = buildAppContext({
      target: target(),
      settings: {
        includeWindowContextInRequests: true,
        clipboardContextInRequests: "off",
      },
    });

    expect(() =>
      assembleModelInput({
        intent: "dictation",
        modeId: "default",
        modePrompt: "",
        appContext,
        hotwords: [],
        now: 1,
      }),
    ).toThrow("dictation model input requires recording");
  });
});
