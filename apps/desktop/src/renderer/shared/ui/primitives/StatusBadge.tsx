import { type ReactNode } from "react";

// Validation/status badge (spec §2.2/§2.7): a signal dot + 11px text — no
// pill background. tone maps ok→teal, warn→neutral-amber, err→red.
export function StatusBadge({
  tone,
  children,
  title,
  "aria-label": ariaLabel,
}: {
  tone: "ok" | "warn" | "err";
  children: ReactNode;
  title?: string;
  "aria-label"?: string;
}): JSX.Element {
  const dotTone = tone === "ok" ? "ok" : tone === "err" ? "error" : "warn";
  return (
    <span className={`status-badge status-badge-${tone}`} title={title} aria-label={ariaLabel}>
      <span className={`dot dot-${dotTone}`} aria-hidden="true" />
      {children}
    </span>
  );
}
