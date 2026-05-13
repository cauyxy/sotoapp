<script lang="ts">
  import PageHeader from "../../shared/ui/PageHeader.svelte";
  import PageFilterRow from "../../shared/ui/PageFilterRow.svelte";
  import SearchToggle from "../../shared/ui/SearchToggle.svelte";
  import {
    deleteDictionaryEntry,
    dictionaryEntryMatches,
    saveDictionaryEntry,
    type DictionaryEntry
  } from "./dictionary.ipc";
  import { dictionaryStore, refreshDictionaryEntries } from "./dictionaryStore";
  import { t } from "../../i18n";
  import { toast } from "../../shared/ui/toast";

  type AddState = { active: false } | { active: true; term: string };
  type VocabFilter = "all" | "auto" | "manual";
  type VocabSource = "auto" | "manual";

  function entrySource(entry: DictionaryEntry): VocabSource {
    return entry.source === "auto_learned" ? "auto" : "manual";
  }

  let query = $state("");
  let filter = $state<VocabFilter>("all");
  let addState = $state<AddState>({ active: false });
  let addInputEl: HTMLInputElement | null = $state(null);

  const total = $derived($dictionaryStore.length);
  const autoCount = $derived($dictionaryStore.filter((entry) => entrySource(entry) === "auto").length);
  const manualCount = $derived(total - autoCount);

  const visibleEntries = $derived(
    $dictionaryStore.filter((entry) => {
      const source = entrySource(entry);
      if (filter !== "all" && source !== filter) return false;
      return dictionaryEntryMatches(entry, query);
    })
  );

  function activateAdd() {
    filter = "all";
    query = "";
    addState = { active: true, term: "" };
    window.requestAnimationFrame(() => addInputEl?.focus());
  }

  function cancelAdd() {
    addState = { active: false };
  }

  async function confirmAdd(rawTerm: string) {
    const trimmed = rawTerm.trim();
    if (!trimmed) return;
    try {
      await saveDictionaryEntry({ id: null, term: trimmed, aliases: [], note: "", enabled: true });
      addState = { active: false };
      await refreshDictionaryEntries();
    } catch (error) {
      console.error("dictionary: failed to save entry", error);
      toast($t("dictionary.msg.saveFailed"));
    }
  }

  async function deleteEntry(entry: DictionaryEntry) {
    try {
      await deleteDictionaryEntry(entry.id);
      await refreshDictionaryEntries();
    } catch (error) {
      console.error("dictionary: failed to delete entry", error);
      toast($t("dictionary.msg.deleteFailed"));
    }
  }

  function handleAddKeydown(event: KeyboardEvent) {
    if (!addState.active) return;
    if (event.key === "Enter") {
      event.preventDefault();
      void confirmAdd(addState.term);
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelAdd();
    }
  }

  function handleAddBlur() {
    if (addState.active && !addState.term.trim()) cancelAdd();
  }

  const filterPills = $derived([
    { id: "all", label: $t("dictionary.filter.all"), count: total },
    { id: "auto", label: $t("dictionary.filter.auto"), count: autoCount, marker: "auto" as const },
    {
      id: "manual",
      label: $t("dictionary.filter.manual"),
      count: manualCount,
      marker: "manual" as const
    }
  ]);
</script>

<main class="page">
  <PageHeader title={$t("dictionary.title")} />
  <PageFilterRow pills={filterPills} activeId={filter} onSelect={(id) => (filter = id as VocabFilter)}>
    {#snippet actions()}
      <SearchToggle
        bind:query
        placeholder={$t("dictionary.searchPlaceholder")}
        ariaOpen={$t("dictionary.searchOpenAria")}
        ariaClose={$t("dictionary.searchClose")}
      />
    {/snippet}
  </PageFilterRow>

  <div class="vocab-grid">
    {#each visibleEntries as entry (entry.id)}
      {@const source = entrySource(entry)}
      <div class="vocab-card vocab-card-row" role="group">
        <span class={`word-mark word-mark-${source}`} aria-hidden="true"></span>
        <span class="vocab-card-term">{entry.term}</span>
        <button
          type="button"
          class="vocab-card-delete"
          aria-label={$t("dictionary.deleteButtonAria", { term: entry.term })}
          onclick={() => void deleteEntry(entry)}
        >×</button>
      </div>
    {/each}
    {#if filter === "all" && !query.trim()}
      {#if addState.active}
        <div class="vocab-card vocab-card-add-input">
          <input
            bind:this={addInputEl}
            value={addState.term}
            oninput={(event) => (addState = { active: true, term: (event.target as HTMLInputElement).value })}
            placeholder={$t("dictionary.addInput.placeholder")}
            onkeydown={handleAddKeydown}
            onblur={handleAddBlur}
          />
        </div>
      {:else}
        <button type="button" class="vocab-card vocab-card-add" onclick={activateAdd}>
          <span class="vocab-card-add-plus">＋</span>
          {$t("dictionary.addPlaceholder")}
        </button>
      {/if}
    {/if}
    {#if visibleEntries.length === 0 && !addState.active}
      <div class="vocab-grid-empty">
        {query.trim() ? $t("dictionary.msg.noMatches") : $t("dictionary.msg.empty")}
      </div>
    {/if}
  </div>
</main>
