export interface DefaultDictionaryTerm {
  id: string;
  term: string;
}

export const DEFAULT_DICTIONARY_TERMS = [
  { id: "dict.default.goal", term: "Goal" },
  { id: "dict.default.typeless", term: "TypeLess" },
  { id: "dict.default.soto", term: "Soto" },
  { id: "dict.default.made-by-xinyu", term: "Made by Xinyu" },
  { id: "dict.default.claude-code", term: "Claude Code" },
  { id: "dict.default.codex", term: "Codex" },
  { id: "dict.default.vibe-coding", term: "Vibe Coding" },
  { id: "dict.default.qwen35-omni", term: "Qwen3.5 Omni" },
  { id: "dict.default.doubao-seed20", term: "Doubao Seed2.0" },
  { id: "dict.default.xiaomi-mimo25", term: "Xiaomi MiMo2.5" },
] as const satisfies readonly DefaultDictionaryTerm[];
