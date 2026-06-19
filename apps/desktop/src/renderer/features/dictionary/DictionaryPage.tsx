import { useCallback, useMemo, useRef, useState } from "react";
import {
  dictionaryEntrySource,
  dictionaryFilterChips,
  filterDictionaryEntries,
  type DictionaryEntry,
  type DictionaryFilter,
} from "@soto/core";

import { PageHeader } from "../../shared/ui/primitives/PageHeader";
import { PageFilterRow, type FilterPill } from "../../shared/ui/primitives/PageFilterRow";
import { SearchToggle } from "../../shared/ui/primitives/SearchToggle";
import { CloseIcon, IconButton } from "../../shared/ui/primitives/IconButton";
import { SignalDot } from "../../shared/ui/primitives/SignalDot";
import { toast } from "../../shared/ui/feedback/toast";
import { useT } from "../../i18n/context";
import { confirmDialog, deleteDictionaryEntry, saveDictionaryEntry } from "../../ipc";
import { useAppModel, useAppResources } from "../../store/appResources";

type AddState = { active: false } | { active: true; term: string };

const FILTER_LABEL_KEYS: Record<DictionaryFilter, string> = {
  all: "dictionary.filter.all",
  auto: "dictionary.filter.auto",
  manual: "dictionary.filter.manual",
};

export function DictionaryPage(): JSX.Element {
  const t = useT();

  // Entries come straight from the AppModel; add/delete mutate through the
  // resource (which refreshes the model), so the page owns no data lifecycle of
  // its own (plan §4.4 / §4.9).
  const entries = useAppModel()?.dictionary ?? [];
  const resources = useAppResources();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<DictionaryFilter>("all");
  const [addState, setAddState] = useState<AddState>({ active: false });
  const addInputRef = useRef<HTMLInputElement | null>(null);

  const visibleEntries = useMemo(
    () => filterDictionaryEntries(entries, filter, query),
    [entries, filter, query],
  );

  function activateAdd(): void {
    setFilter("all");
    setQuery("");
    setAddState({ active: true, term: "" });
    window.requestAnimationFrame(() => addInputRef.current?.focus());
  }

  function cancelAdd(): void {
    setAddState({ active: false });
  }

  const confirmAdd = useCallback(
    async (rawTerm: string) => {
      const trimmed = rawTerm.trim();
      if (!trimmed) return;
      try {
        await resources.mutate(() => saveDictionaryEntry(null, trimmed), "dictionary");
        setAddState({ active: false });
      } catch (error) {
        console.error("dictionary: failed to save entry", error);
        toast(t("dictionary.msg.saveFailed"));
      }
    },
    [resources, t],
  );

  const deleteEntry = useCallback(
    async (entry: DictionaryEntry) => {
      const ok = await confirmDialog({
        message: t("dictionary.confirmDelete.message"),
        detail: t("dictionary.confirmDelete.detail"),
        confirmLabel: t("dictionary.confirmDelete.confirm"),
        cancelLabel: t("common.cancel"),
      });
      if (!ok) return;
      try {
        await resources.mutate(() => deleteDictionaryEntry(entry.id), "dictionary");
      } catch (error) {
        console.error("dictionary: failed to delete entry", error);
        toast(t("dictionary.msg.deleteFailed"));
      }
    },
    [resources, t],
  );

  function handleAddKeydown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (!addState.active) return;
    if (event.key === "Enter") {
      event.preventDefault();
      void confirmAdd(addState.term);
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelAdd();
    }
  }

  function handleAddBlur(): void {
    if (addState.active && !addState.term.trim()) cancelAdd();
  }

  const filterPills = useMemo<FilterPill[]>(
    () =>
      dictionaryFilterChips(entries).map((chip) => ({
        id: chip.id,
        label: t(FILTER_LABEL_KEYS[chip.id]),
        count: chip.count,
        ...(chip.id === "all" ? {} : { marker: chip.id }),
      })),
    [t, entries],
  );

  const showAddSlot = filter === "all" && !query.trim();

  return (
    <section className="page dictionary-page">
      <PageHeader title={t("dictionary.title")} />
      <PageFilterRow
        pills={filterPills}
        activeId={filter}
        onSelect={(id) => setFilter(id as DictionaryFilter)}
        actions={
          <SearchToggle
            query={query}
            onChange={setQuery}
            placeholder={t("dictionary.searchPlaceholder")}
            ariaOpen={t("dictionary.searchOpenAria")}
            ariaClose={t("dictionary.searchClose")}
          />
        }
      />

      <div className="group vocab-card">
        <div
          className="vocab-flow page-scroll"
          role="group"
          aria-label={t("dictionary.listAria", { count: visibleEntries.length })}
        >
          {/* Add control is the first capsule in the cloud (spec §2.4). */}
          {showAddSlot ? (
            addState.active ? (
              <div className="vocab-cap-input">
                <input
                  ref={addInputRef}
                  value={addState.term}
                  onChange={(event) => setAddState({ active: true, term: event.target.value })}
                  placeholder={t("dictionary.addInput.placeholder")}
                  aria-label={t("dictionary.addInput.placeholder")}
                  onKeyDown={handleAddKeydown}
                  onBlur={handleAddBlur}
                />
              </div>
            ) : (
              <button type="button" className="vocab-cap-add" onClick={activateAdd}>
                <span className="vocab-cap-add-glyph" aria-hidden="true">+</span>
                {t("dictionary.addPlaceholder")}
              </button>
            )
          ) : null}
          {visibleEntries.map((entry) => {
            const source = dictionaryEntrySource(entry);
            // Source + usage survive as a hover tooltip (the visible meta row is
            // dropped — the dot now carries source; spec §2.1).
            const sourceLabel = t(
              source === "manual" ? "dictionary.filter.manual" : "dictionary.filter.auto",
            );
            const title =
              entry.hit_count > 0
                ? `${sourceLabel} · ${t("dictionary.hits", { count: entry.hit_count })}`
                : sourceLabel;
            return (
              <div className="vocab-cap" key={entry.id} title={title}>
                <SignalDot tone={source === "manual" ? "ok" : "neutral"} />
                <span className="vocab-cap-term vocab-term">{entry.term}</span>
                <IconButton
                  className="vocab-cap-del"
                  icon={<CloseIcon />}
                  label={t("dictionary.deleteButtonAria", { term: entry.term })}
                  size="sm"
                  onClick={() => void deleteEntry(entry)}
                />
              </div>
            );
          })}
          {visibleEntries.length === 0 && !addState.active ? (
            <div className="vocab-empty">
              {query.trim() ? t("dictionary.msg.noMatches") : t("dictionary.msg.empty")}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
