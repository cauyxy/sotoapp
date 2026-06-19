import type { Mode } from "@soto/core";

// Mode identity tone: translate reads violet (the info/LLM signal), and every
// dictation mode reads teal.
// Shared so Home recent rows and mode identity surfaces cannot drift apart.
export function modeTone(mode: Pick<Mode, "id"> | null): "ok" | "info" {
  if (mode?.id === "translate") return "info";
  return "ok";
}
