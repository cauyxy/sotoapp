import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import type { HistoryRecord } from "@soto/core";

import { PageHeader } from "../../shared/ui/primitives/PageHeader";
import { PageFilterRow, type FilterPill } from "../../shared/ui/primitives/PageFilterRow";
import { SearchToggle } from "../../shared/ui/primitives/SearchToggle";
import { Button } from "../../shared/ui/primitives/Button";
import { SignalDot } from "../../shared/ui/primitives/SignalDot";
import { toast } from "../../shared/ui/feedback/toast";
import { useT } from "../../i18n/context";
import { useAppModel, useAppResources } from "../../store/appResources";
import { clearHistory, confirmDialog, deleteHistoryRecord } from "../../ipc";
import {
  AlertLevel,
  pushAlert,
  removeAlert,
} from "../../shared/ui/feedback/alerts";
import {
  historyDesignGroups,
  historyFilterChips,
  historyGroupKey,
  type HistoryDesignRow,
} from "./model/historyModel";
import { createPendingDeletes } from "./model/pendingDeletes";
import { canonicalModeLabel } from "../../shared/canonicalModes";
import { modeTone } from "../../shared/modeTone";

// How long a single-delete stays undoable before it commits. The undo toast's
// TTL matches, so the affordance disappears exactly when the delete lands.
const HISTORY_UNDO_WINDOW_MS = 4000;

export function HistoryPage(): JSX.Element {
  const t = useT();
  const model = useAppModel();
  const resources = useAppResources();

  // Mode lookup for dot identity — mirrors the pattern from HomePage.
  const modes = model?.modes ?? [];

  // Records come straight from the AppModel's recent history — it refreshes on a
  // terminal dictation via AppResources, so the page owns no boot-hydrate /
  // reload lifecycle of its own (plan §4.8). A locally-removed set hides rows
  // that are mid-undo or being committed, so an optimistic delete shows
  // instantly without the row flashing back before the model refresh lands.
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(() => new Set());
  const allRecords = model?.recentHistory ?? [];
  const records = useMemo(
    () => allRecords.filter((record) => !removedIds.has(record.id)),
    [allRecords, removedIds],
  );

  // Latest translator, read by the (stable) deferred-delete commit so its error
  // toast picks up the current locale without re-creating the helper.
  const tRef = useRef(t);
  tRef.current = t;

  // Stable ref to the model records so the (stable) delete handler can look up
  // the full record to defer without depending on the changing list.
  const allRecordsRef = useRef(allRecords);
  allRecordsRef.current = allRecords;

  function dropRemoved(id: string): void {
    setRemovedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  // Deferred single-delete ("undo"): the row is hidden (removedIds) immediately,
  // and the real delete commits after the window via a resource mutation (which
  // refreshes the model). The row stays hidden until the mutation settles, so a
  // successful delete never flashes back; a failed one un-hides + toasts. Created
  // once (stable); the callbacks close over stable setters + the resource.
  const pendingDeletes = useRef<ReturnType<typeof createPendingDeletes<HistoryRecord>>>();
  if (pendingDeletes.current === undefined) {
    pendingDeletes.current = createPendingDeletes<HistoryRecord>({
      idOf: (record) => record.id,
      delayMs: HISTORY_UNDO_WINDOW_MS,
      commit: (record) => {
        void resources
          .mutate(() => deleteHistoryRecord(record.id), "history")
          .then(() => dropRemoved(record.id))
          .catch((error) => {
            console.error("history: delete failed", error);
            toast(tRef.current("history.deleteFailed"));
            dropRemoved(record.id);
          });
      },
      // Undo: stop hiding the row (the model still has it, so it reappears).
      restore: (record) => dropRemoved(record.id),
    });
  }
  const pending = pendingDeletes.current;

  const [query, setQuery] = useState("");
  const [filterId, setFilterId] = useState("all");
  const [now, setNow] = useState<Date>(() => new Date());

  // Buckets ("today" / "yesterday" / "monthDay") only flip at local midnight.
  // Arm one timer for just after the next midnight relative to `now`; when it
  // fires, `now` advances and this effect re-arms for the following midnight —
  // cheaper than a 60s re-derive that almost never changes a bucket, and a plain
  // reactive effect rather than a mount-only state initializer.
  useEffect(() => {
    const nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 1, 0);
    const delay = Math.max(60_000, nextMidnight.getTime() - now.getTime());
    const timer = window.setTimeout(() => setNow(new Date()), delay);
    return () => window.clearTimeout(timer);
  }, [now]);

  // No local voice-runtime refresh: AppResources refreshes the model on a
  // terminal event, and `records` derives from model.recentHistory, so a new
  // dictation appears here automatically.

  const filterPills = useMemo<FilterPill[]>(
    () =>
      historyFilterChips(records).map((chip) => ({
        id: chip.id,
        label:
          chip.kind === "all"
            ? t("history.filterAll")
            : canonicalModeLabel(t, chip.modeId) ??
              modes.find((mode) => mode.id === chip.modeId)?.name ??
              t("modes.deletedMode"),
        count: chip.count,
      })),
    [modes, records, t],
  );

  const groups = useMemo(
    () => historyDesignGroups(records, now, filterId, query),
    [records, now, filterId, query],
  );
  const empty = useMemo(() => groups.every((group) => group.rows.length === 0), [groups]);

  const copyRecord = useCallback(
    async (row: HistoryDesignRow) => {
      try {
        await navigator.clipboard.writeText(row.polished);
      } catch (error) {
        console.error("history: clipboard write failed", error);
        toast(t("history.copyFailed"));
      }
    },
    [t],
  );

  const deleteRecord = useCallback(
    (row: HistoryDesignRow) => {
      const record = allRecordsRef.current.find((r) => r.id === row.id);
      if (record === undefined) return;

      // Optimistic hide — instant UI feedback — but DEFER the real delete so the
      // user can undo within the window. schedule() returns false (and we bail)
      // if this row is already mid-undo, so a repeat click can't queue two.
      if (!pending.schedule(record)) return;
      setRemovedIds((prev) => new Set(prev).add(row.id));

      const alertId = `history-undo-${row.id}`;
      pushAlert({
        id: alertId,
        level: AlertLevel.TEMPORARY,
        title: t("history.deletedUndo"),
        ttl: HISTORY_UNDO_WINDOW_MS,
        action: {
          label: t("common.undo"),
          // undo() cancels the timer + restores the record (the derivation
          // re-sorts, so it lands back in its original position). Always dismiss
          // the toast; the restore is a no-op if the delete already committed.
          handler: () => {
            pending.undo(row.id);
            removeAlert(alertId);
          },
        },
      });
    },
    [pending, t],
  );

  // Unmount safety: flush any still-pending deletes so navigating away COMMITS
  // them (rather than resurrecting a row the user deleted). The helper clears the
  // timers, so a deferred commit can't fire after teardown. Mount-once: the
  // helper + setters are stable, so this teardown runs only on real unmount.
  useEffect(() => {
    return () => pending.flushAll();
  }, [pending]);

  const clearAll = useCallback(async () => {
    // Irreversible: gate behind a native OS confirmation before wiping anything.
    const ok = await confirmDialog({
      message: t("history.confirmClear.message"),
      detail: t("history.confirmClear.detail"),
      confirmLabel: t("history.clearAll"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    try {
      // Mutating through the resource refreshes the model, so the list empties
      // when the model's recent history comes back empty.
      await resources.mutate(() => clearHistory(), "history");
    } catch (error) {
      console.error("history: clear failed", error);
      toast(t("history.deleteFailed"));
    }
  }, [resources, t]);

  const hasRecords = records.length > 0;

  type VirtualItem =
    | { type: "header"; group: typeof groups[0] }
    | { type: "row"; row: HistoryDesignRow };

  const flatItems = useMemo(() => {
    const items: VirtualItem[] = [];
    for (const group of groups) {
      items.push({ type: "header", group });
      for (const row of group.rows) {
        items.push({ type: "row", row });
      }
    }
    return items;
  }, [groups]);

  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (flatItems[index]!.type === "header" ? 42 : 120),
    getItemKey: (index) => {
      const item = flatItems[index]!;
      return item.type === "header" ? `header-${historyGroupKey(item.group)}` : `row-${item.row.id}`;
    },
  });

  return (
    <section className="page history-page">
      <PageHeader title={t("history.pageTitle")} />
      <PageFilterRow
        pills={filterPills}
        activeId={filterId}
        onSelect={(id) => setFilterId(id)}
        actions={
          <>
            {hasRecords ? (
              <Button variant="link" onClick={() => void clearAll()}>
                {t("history.clearAll")}
              </Button>
            ) : null}
            <SearchToggle
              query={query}
              onChange={setQuery}
              placeholder={t("history.searchPlaceholder")}
              ariaOpen={t("history.searchAria")}
              ariaClose={t("history.searchClose")}
            />
          </>
        }
      />
      <div ref={scrollRef} className="history-scroll page-scroll">
        {empty ? (
          <section className="group">
            <div className="group-title">{t("history.groupTitle")}</div>
            <div className="empty">
              {query.trim() || filterId !== "all"
                ? t("history.empty.noMatches")
                : t("history.empty.body")}
            </div>
          </section>
        ) : (
          <div style={{ position: "relative", height: `${virtualizer.getTotalSize()}px`, width: "100%" }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const item = flatItems[virtualRow.index]!;

              if (item.type === "header") {
                const group = item.group;
                const primaryLabel =
                  group.primaryKind === "today"
                    ? t("history.bucket.today")
                    : group.primaryKind === "yesterday"
                      ? t("history.bucket.yesterday")
                      : group.primaryKind === "monthDay" && group.primaryMonth && group.primaryDay
                        ? t("history.bucket.monthDay", { month: group.primaryMonth, day: group.primaryDay })
                        : t("common.em");

                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <section className="history-design-group">
                      <header className="history-design-head" style={{ marginTop: virtualRow.index === 0 ? 0 : 32 }}>
                        <span className="history-design-primary">{primaryLabel}</span>
                        <span className="history-design-date">{group.date}</span>
                      </header>
                    </section>
                  </div>
                );
              }

              const row = item.row;
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <section className="history-design-group">
                    <article className="history-design-row">
                      <div className="history-design-meta">
                        <SignalDot tone={modeTone(modes.find((m) => m.id === row.mode) ?? null)} />
                        <span>{row.time}</span>
                        <span>·</span>
                        <span>{row.duration}</span>
                        <span>·</span>
                        <span>{t("history.chars", { count: row.chars })}</span>
                        <span>·</span>
                        <span className="history-design-mode">
                          {canonicalModeLabel(t, row.mode) ??
                            modes.find((mode) => mode.id === row.mode)?.name ??
                            t("modes.deletedMode")}
                        </span>
                        <span className="history-design-actions">
                          <Button variant="link" onClick={() => void copyRecord(row)}>
                            {t("common.copy")}
                          </Button>
                          <Button
                            variant="link"
                            aria-label={t("history.deleteAria")}
                            onClick={() => deleteRecord(row)}
                          >
                            {t("common.delete")}
                          </Button>
                        </span>
                      </div>
                      {row.polished ? (
                        <div className="history-design-polished">{row.polished}</div>
                      ) : (
                        /* Cancelled/empty/failed sessions persist with no text —
                         * show a dimmed status word instead of a blank line. */
                        <div className="history-design-polished history-design-placeholder">
                          {t(`history.statusLabel.${row.status}`)}
                        </div>
                      )}
                      {row.raw ? (
                        <div className="history-design-raw">
                          <span className="history-design-raw-tag">{t("history.raw")}</span>
                          {row.raw}
                        </div>
                      ) : null}
                    </article>
                  </section>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
