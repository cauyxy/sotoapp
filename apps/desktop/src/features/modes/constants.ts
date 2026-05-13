export const DEFAULT_MODES = [
  {
    id: "direct",
    name: "Quick",
    hotkey: "⌥ Space",
    behavior: "Hold",
    rewrite: "Direct transcript"
  },
  {
    id: "polish",
    name: "Polish",
    hotkey: "⌥ P",
    behavior: "Hold",
    rewrite: "Text rewrite"
  }
] as const;
