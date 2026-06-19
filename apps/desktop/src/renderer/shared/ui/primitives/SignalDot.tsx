// The 5px signal dot — the universal status/identity vocabulary (spec §2.2).
// Tones map to the per-appearance accent tokens; `breathe` is the idle-life
// animation (collapses under prefers-reduced-motion via the global guard).
export type SignalTone = "ok" | "info" | "warn" | "error" | "neutral";

export function SignalDot({
  tone = "neutral",
  breathe = false,
}: {
  tone?: SignalTone;
  breathe?: boolean;
}): JSX.Element {
  return <span className={`dot dot-${tone}${breathe ? " dot-breathe" : ""}`} aria-hidden="true" />;
}
