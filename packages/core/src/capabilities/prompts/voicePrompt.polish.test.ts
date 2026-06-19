import { describe, expect, it } from "vitest";
import { buildPolishPrompt } from "./voicePrompt.js";
import type { AxContext } from "../../contract/schema.js";

const HOTWORDS = ["Soto", "Claude Code"];
const AX: AxContext = {
  full_text: "abcdef", selection_start: 1, selection_end: 3,
  before: "a", after: "def", ax_role: "AXTextArea", app_bundle_id: "com.x",
  app_name: "X", window_title: "Draft",
  web_url: "https://docs.google.com/document/d/abc", web_domain: null,
};

describe("buildPolishPrompt", () => {
  it("uses the mode prompt exactly, even when empty, and keeps hotwords in the user prompt", () => {
    const p = buildPolishPrompt("", HOTWORDS, null, "hello world");
    expect(p.systemPrompt).toBe("");
    expect(p.systemPrompt).not.toContain("<热词>");
    expect(p.systemPrompt).not.toContain("<当前输入框上下文>");
    expect(p.userPrompt).toBe(
      "<原始转写>\nhello world\n</原始转写>\n\n<热词>\nSoto、Claude Code\n</热词>",
    );
  });

  it("uses the mode prompt as the whole system prompt and appends the ax block to the user prompt", () => {
    const p = buildPolishPrompt("Translate into English.", HOTWORDS, AX, "你好");
    expect(p.systemPrompt).toBe("Translate into English.");
    expect(p.userPrompt).toContain("应用：X（com.x）");
    expect(p.userPrompt).toContain("窗口：Draft");
    expect(p.userPrompt).toContain("网页：docs.google.com");
    expect(p.userPrompt).toContain("输入框类型：AXTextArea");
    expect(p.userPrompt).toContain("<原始转写>\n你好\n</原始转写>");
  });

  it("keeps the controlled app profile block in the user prompt before hotwords", () => {
    const p = buildPolishPrompt("Clean up.", HOTWORDS, null, "raw", {
      appProfile: { registerHint: "formal", structuredBias: true },
    });
    expect(p.systemPrompt).toBe("Clean up.");
    expect(p.userPrompt).toContain("<应用后处理>\n语体：formal\n结构化：true\n</应用后处理>");
    expect(p.userPrompt.indexOf("<应用后处理>")).toBeLessThan(p.userPrompt.indexOf("<热词>"));
  });
});
