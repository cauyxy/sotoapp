import { type ReactNode } from "react";

import { useT } from "../../../i18n/context";

export type PageFilterMarker = "ok" | "auto" | "manual";

export interface FilterPill {
  id: string;
  label: string;
  count?: number;
  marker?: PageFilterMarker;
}

export function PageFilterRow({
  pills,
  activeId,
  onSelect,
  actions,
  groupLabel,
}: {
  pills: FilterPill[];
  activeId: string;
  onSelect: (id: string) => void;
  actions?: ReactNode;
  /** Accessible name for the filter group. Defaults to t("common.filters"). */
  groupLabel?: string;
}): JSX.Element {
  const t = useT();
  return (
    <div className="page-filter-row">
      <div className="page-filter-pills" role="group" aria-label={groupLabel ?? t("common.filters")}>
        {pills.map((pill) => {
          const active = activeId === pill.id;
          return (
            <button
              key={pill.id}
              type="button"
              aria-pressed={active}
              className={`page-filter-pill${active ? " active" : ""}`}
              onClick={() => onSelect(pill.id)}
            >
              {pill.marker === "ok" ? (
                <span className="dot dot-ok" aria-hidden="true" />
              ) : pill.marker === "auto" ? (
                <span className="word-mark word-mark-auto" aria-hidden="true" />
              ) : pill.marker === "manual" ? (
                <span className="word-mark word-mark-manual" aria-hidden="true" />
              ) : null}
              <span>{pill.label}</span>
              {pill.count !== undefined ? (
                <span className="page-filter-pill-count">{pill.count}</span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="page-filter-actions">{actions}</div>
    </div>
  );
}
