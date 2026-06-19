import { forwardRef, type KeyboardEventHandler, type ReactNode } from "react";

// Shared icon-only button primitive. Renders the consolidated `.icon-button`
// shell (reset + inline-flex centring + size + focus, in styles/buttons.css)
// plus a size modifier; the SVG glyph is passed in via `icon`. A `label` is
// REQUIRED and becomes the aria-label (icon buttons have no visible text).
//
// `className` is appended so positioned / hover-reveal contexts (the absolutely
// positioned alert dismiss, the hover-revealed vocab-card delete, the inline
// search-close) keep their own context class — that's what drives positioning,
// the `.vocab-card-row:hover` reveal, and the base.css :focus-visible offset
// selectors. The shell/size/glyph now come from `.icon-button`.
export interface IconButtonProps {
  icon: ReactNode;
  /** Becomes aria-label — required, since the button has no visible text. */
  label: string;
  onClick?: () => void;
  /**
   * "sm" = fixed 22px circle (vocab delete); "md" (default) hugs the glyph,
   * matching the intrinsic footprint of the alert/search close buttons it
   * replaced (they were never a fixed box). Add a fixed-size variant if a future
   * consumer needs a larger fixed tap target — don't assume "md" is ~32px.
   */
  size?: "sm" | "md";
  /** Appended after the shell classes — used for positioned/hover contexts. */
  className?: string;
  type?: "button" | "submit" | "reset";
  id?: string;
  disabled?: boolean;
  onKeyDown?: KeyboardEventHandler<HTMLButtonElement>;
  "aria-expanded"?: boolean;
  "aria-controls"?: string;
  "aria-haspopup"?: boolean | "menu" | "listbox";
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({
  icon,
  label,
  onClick,
  size = "md",
  className,
  type = "button",
  "aria-expanded": ariaExpanded,
  "aria-controls": ariaControls,
  "aria-haspopup": ariaHasPopup,
  id,
  disabled,
  onKeyDown,
}, ref): JSX.Element {
  return (
    <button
      ref={ref}
      type={type}
      id={id}
      className={`icon-button icon-button-${size} ${className ?? ""}`}
      aria-label={label}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      aria-haspopup={ariaHasPopup}
      disabled={disabled}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {icon}
    </button>
  );
});

// Shared "×" close glyph so every close button renders the identical mark
// (instead of each hand-typing a literal ×, which varied between the full-width
// and ASCII characters). Sized to inherit `currentColor`; the icon-button shell
// centres it.
export function CloseIcon(): JSX.Element {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="M4 4 L12 12 M12 4 L4 12" />
    </svg>
  );
}
