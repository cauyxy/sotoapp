import { type ReactNode } from "react";

// Shared pill-button primitive (spec §2.3). Variants:
//   primary — teal ~15% fill + teal text + hairline (save / verify actions).
//   ghost   — hairline + secondary ink.
//   link    — borderless link-style ghost.
// `progress` drives the capsule width-grow waiting fill: "waiting" grows a
// teal band left-to-right (fast-then-slow); "success" snaps it to 100%.
export function Button({
  variant = "primary",
  children,
  onClick,
  disabled,
  type = "button",
  title,
  progress = null,
  "aria-label": ariaLabel,
}: {
  variant?: "primary" | "ghost" | "link";
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  title?: string;
  progress?: "waiting" | "success" | null;
  "aria-label"?: string;
}): JSX.Element {
  return (
    <button
      type={type}
      className={`button button-${variant}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      aria-busy={progress === "waiting" || undefined}
      data-progress={progress ?? undefined}
    >
      <span className="button-fill" aria-hidden="true" />
      <span className="button-label">{children}</span>
    </button>
  );
}
