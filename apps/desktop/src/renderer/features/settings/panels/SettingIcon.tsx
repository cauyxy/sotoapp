// Inline-SVG glyphs for the settings rows (icon-list redesign, variant D).
// Same drawing convention as NavIcon / the permission glyphs: 24-unit viewBox,
// 1.6 stroke, currentColor — the .setting-row-tile sets size + color.

export type SettingIconName =
  | "microphone"
  | "textSize"
  | "dock"
  | "startup"
  | "privacy"
  | "proxy";

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export function SettingIcon({ name }: { name: SettingIconName }): JSX.Element {
  switch (name) {
    case "microphone":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5.5 11 a6.5 6.5 0 0 0 13 0" />
          <path d="M12 17.5 V21" />
          <path d="M8.5 21 H15.5" />
        </svg>
      );
    case "textSize":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
          <path d="M3.5 18 L7.5 7 L11.5 18" />
          <path d="M4.9 14.4 H10.1" />
          <path d="M14 18 L16.6 10.5 L19.2 18" />
          <path d="M14.9 15.4 H18.3" />
        </svg>
      );
    case "dock":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
          <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
          <path d="M3.5 15.5 H20.5" />
          <circle cx="8" cy="17.5" r="0.9" fill="currentColor" stroke="none" />
          <circle cx="12" cy="17.5" r="0.9" fill="currentColor" stroke="none" />
          <circle cx="16" cy="17.5" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      );
    case "startup":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
          <path d="M12 3.5 V9.5" />
          <path d="M7.5 6.5 A8 8 0 1 0 16.5 6.5" />
          <path d="M12 15.5 L12 20.5" />
          <path d="M9.5 18 L12 15.5 L14.5 18" />
        </svg>
      );
    case "privacy":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
          <path d="M12 3.5 L19 6 V11.5 C19 16.3 16.1 19.4 12 20.5 C7.9 19.4 5 16.3 5 11.5 V6 Z" />
          <path d="M9 12 L11.1 14.1 L15.2 9.9" />
        </svg>
      );
    case "proxy":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...STROKE}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M3.5 12 H20.5" />
          <path d="M12 3.5 C8 7 8 17 12 20.5 C16 17 16 7 12 3.5 Z" />
        </svg>
      );
  }
}
