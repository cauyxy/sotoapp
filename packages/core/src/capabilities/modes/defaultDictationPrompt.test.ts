import { describe, expect, it } from "vitest";

import { DEFAULT_DICTATION_PROMPT } from "./defaultDictationPrompt.js";
import { DEFAULT_TRANSLATE_PROMPT } from "./defaultTranslatePrompt.js";

describe("built-in dictation prompts", () => {
  it("keeps the default dictation prompt as a non-empty code source of truth", () => {
    expect(DEFAULT_DICTATION_PROMPT.length).toBeGreaterThan(1000);
    expect(DEFAULT_DICTATION_PROMPT).toContain("# 角色定位");
    expect(DEFAULT_DICTATION_PROMPT).toContain("语音输入整理模块");
    expect(DEFAULT_DICTATION_PROMPT).toContain("转写 + 清洗 + 排版");
    expect(DEFAULT_DICTATION_PROMPT).toContain("以「...」结尾");
    expect(DEFAULT_DICTATION_PROMPT).not.toContain("系统消息");
  });

  it("keeps the translate mode from falling through to the audio fallback", () => {
    expect(DEFAULT_TRANSLATE_PROMPT.length).toBeGreaterThan(1000);
    expect(DEFAULT_TRANSLATE_PROMPT).toContain("# 角色定位");
    expect(DEFAULT_TRANSLATE_PROMPT).toContain("语音翻译模块");
    expect(DEFAULT_TRANSLATE_PROMPT).toContain("忠实翻译 + 排版");
    expect(DEFAULT_TRANSLATE_PROMPT).toContain("绝不作答");
    expect(DEFAULT_TRANSLATE_PROMPT).toContain("Here's the deployment process:");
  });
});
