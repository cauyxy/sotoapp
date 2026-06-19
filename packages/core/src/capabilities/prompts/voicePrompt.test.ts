import { describe, expect, it } from "vitest";
import {
  buildVoicePrompt,
  readActiveHotwords,
  score,
} from "./voicePrompt.js";
import type { AxContext, DictionaryEntry } from "../../contract/schema.js";

function entry(over: Partial<DictionaryEntry> & { term: string }): DictionaryEntry {
  return {
    id: over.term,
    term: over.term,
    source: over.source ?? "auto_learned",
    hit_count: over.hit_count ?? 0,
    last_used_at: over.last_used_at ?? null,
    created_at: over.created_at ?? 0n,
  };
}

describe("buildVoicePrompt", () => {
  it("keeps the fallback body as the whole system prompt and puts hotwords in the user prompt", () => {
    const prompt = buildVoicePrompt("", [], null);

    expect(prompt.systemPrompt).toBe("Respond to the following audio.");
    expect(prompt.userPrompt).toBe(
      "请将这段语音转写并整理后输出\n\n<热词>\n\n</热词>",
    );
  });

  it("preserves a non-empty mode prompt as the whole system prompt and joins user hotwords with the ideographic comma", () => {
    const prompt = buildVoicePrompt("Please transcribe", ["Soto", "Doubao"], null);
    expect(prompt.systemPrompt).toBe("Please transcribe");
    expect(prompt.userPrompt).toBe(
      "请将这段语音转写并整理后输出\n\n<热词>\nSoto、Doubao\n</热词>",
    );
  });

  it("appends the AX-context block to the user prompt with the exact layout when provided", () => {
    const ctx: AxContext = {
      full_text: "hello world",
      selection_start: 5,
      selection_end: 5,
      before: "hello",
      after: " world",
      ax_role: "AXTextField",
      app_bundle_id: "com.example.app",
      app_name: "Example",
      window_title: "Quick update - Example",
      web_url: "https://mail.google.com/mail/u/0/#inbox",
      web_domain: null,
    };
    const prompt = buildVoicePrompt("Please transcribe", [], ctx);
    expect(prompt.systemPrompt).toBe("Please transcribe");
    expect(prompt.userPrompt).toBe(
      "请将这段语音转写并整理后输出\n\n<热词>\n\n</热词>\n\n" +
        "<当前输入框上下文>\n" +
        "应用：Example（com.example.app）\n" +
        "窗口：Quick update - Example\n" +
        "网页：mail.google.com\n" +
        "输入框类型：AXTextField\n" +
        "光标前：hello\n" +
        "光标后： world\n" +
        "</当前输入框上下文>",
    );
  });

  it("omits empty enhanced context rows", () => {
    const ctx: AxContext = {
      full_text: "",
      selection_start: 0,
      selection_end: 0,
      before: "",
      after: "",
      ax_role: null,
      app_bundle_id: null,
      app_name: null,
      window_title: null,
      web_url: null,
      web_domain: null,
    };
    expect(buildVoicePrompt("x", [], ctx).userPrompt).not.toContain("<当前输入框上下文>");
  });

  it("keeps app profile hints in the user prompt before hotwords", () => {
    const prompt = buildVoicePrompt("Please transcribe", ["Soto"], null, {
      appProfile: { registerHint: "code", punctuationStyle: "light", structuredBias: true },
    });
    expect(prompt.systemPrompt).toBe("Please transcribe");
    expect(prompt.userPrompt).toBe(
      "请将这段语音转写并整理后输出\n\n" +
        "<应用后处理>\n语体：code\n标点：light\n结构化：true\n</应用后处理>\n\n" +
        "<热词>\nSoto\n</热词>",
    );
  });
});

describe("readActiveHotwords", () => {
  it("returns an empty list for an empty dictionary", () => {
    expect(readActiveHotwords([], 0)).toEqual([]);
  });

  it("keeps all user-added terms first, in input order", () => {
    const result = readActiveHotwords(
      [entry({ term: "Foo", source: "user_added" }), entry({ term: "Bar", source: "user_added" })],
      0,
    );
    expect(result).toEqual(["Foo", "Bar"]);
  });

  it("appends auto-learned terms ordered by descending score after user-added terms", () => {
    const now = 1_000_000_000_000;
    const result = readActiveHotwords(
      [
        entry({ term: "Manual", source: "user_added" }),
        entry({ term: "Cold", source: "auto_learned", hit_count: 0, last_used_at: 0n }),
        entry({ term: "Hot", source: "auto_learned", hit_count: 100, last_used_at: BigInt(now) }),
      ],
      now,
    );
    expect(result).toEqual(["Manual", "Hot", "Cold"]);
  });

  it("honors the remaining term budget for auto-learned terms", () => {
    const now = 1_000_000_000_000;
    const result = readActiveHotwords(
      [
        entry({ term: "Manual", source: "user_added" }),
        entry({ term: "Hot", source: "auto_learned", hit_count: 100, last_used_at: BigInt(now) }),
        entry({ term: "Cold", source: "auto_learned", hit_count: 0, last_used_at: 0n }),
      ],
      now,
      { maxTerms: 2, maxTokensEst: 500 },
    );
    expect(result).toEqual(["Manual", "Hot"]);
  });
});

describe("score", () => {
  it("weights frequency and recency (recent high-hit beats old zero-hit)", () => {
    const now = 1_000_000_000_000;
    const hot = score(entry({ term: "h", hit_count: 100, last_used_at: BigInt(now) }), now);
    const cold = score(entry({ term: "c", hit_count: 0, last_used_at: 0n }), now);
    expect(hot).toBeGreaterThan(cold);
  });

  it("uses a neutral recency of 0.5 when last_used_at is null", () => {
    expect(score(entry({ term: "x", hit_count: 0, last_used_at: null }), 0)).toBeCloseTo(0.2, 10);
  });
});
