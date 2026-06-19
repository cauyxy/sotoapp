export type UtilIconName = "help" | "chat" | "globe" | "theme-system" | "theme-light" | "theme-dark";

export function UtilIcon({ name }: { name: UtilIconName }): JSX.Element {
  if (name === "help") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M9.5 9.5 a2.5 2.5 0 0 1 5 0 c0 1.5 -2.5 2 -2.5 3.5" />
        <circle cx="12" cy="16.5" r="0.6" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (name === "chat") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4.5 5.5 H19.5 a1 1 0 0 1 1 1 V15 a1 1 0 0 1 -1 1 H10 L6 19.5 V16 H4.5 a1 1 0 0 1 -1 -1 V6.5 a1 1 0 0 1 1 -1 Z" />
      </svg>
    );
  }
  if (name === "globe") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M3.5 12 H20.5" />
        <path d="M12 3.5 C15 6 15 18 12 20.5 C9 18 9 6 12 3.5 Z" />
      </svg>
    );
  }
  if (name === "theme-system") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="4" y="5" width="16" height="11" rx="1.5" />
        <path d="M9 19 H15" />
        <path d="M12 16 V19" />
      </svg>
    );
  }
  if (name === "theme-light") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3.5" />
        <path d="M12 2.75 V5" />
        <path d="M12 19 V21.25" />
        <path d="M2.75 12 H5" />
        <path d="M19 12 H21.25" />
        <path d="M5.45 5.45 L7.05 7.05" />
        <path d="M16.95 16.95 L18.55 18.55" />
        <path d="M18.55 5.45 L16.95 7.05" />
        <path d="M7.05 16.95 L5.45 18.55" />
      </svg>
    );
  }
  // theme-dark
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18.2 15.1 A7.1 7.1 0 0 1 8.9 5.8 A7.5 7.5 0 1 0 18.2 15.1 Z" />
    </svg>
  );
}
