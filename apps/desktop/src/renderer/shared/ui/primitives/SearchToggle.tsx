import { useCallback, useState } from "react";

import { CloseIcon, IconButton } from "./IconButton";

// Collapsible search field used in the History / Dictionary filter rows. The
// old build used a `$bindable` query prop; here the query is controlled via
// value + onChange. Closing clears the query (matches the old behavior).
export function SearchToggle({
  query,
  onChange,
  placeholder,
  ariaOpen,
  ariaClose,
}: {
  query: string;
  onChange: (next: string) => void;
  placeholder: string;
  ariaOpen: string;
  ariaClose: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);

  // Focus the field as it mounts (i.e. when search opens). A stable ref callback
  // runs once on mount — replacing a static `autoFocus` (react-doctor/no-autofocus)
  // and a state->effect focus hop (react-doctor/no-event-handler) — so the focus
  // is a direct consequence of the field appearing, not page load.
  const focusOnMount = useCallback((node: HTMLInputElement | null) => {
    node?.focus();
  }, []);

  function closeSearch(): void {
    setOpen(false);
    onChange("");
  }

  if (open) {
    return (
      <div className="page-filter-search-open">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.4 10.4 L13.5 13.5" />
        </svg>
        <input
          ref={focusOnMount}
          aria-label={ariaOpen}
          value={query}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              closeSearch();
            }
          }}
        />
        <IconButton
          icon={<CloseIcon />}
          label={ariaClose}
          className="page-filter-search-close"
          size="md"
          onClick={closeSearch}
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      className="page-filter-search-icon-btn"
      aria-label={ariaOpen}
      onClick={() => setOpen(true)}
    >
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
        <circle cx="7" cy="7" r="4.5" />
        <path d="M10.4 10.4 L13.5 13.5" />
      </svg>
    </button>
  );
}
