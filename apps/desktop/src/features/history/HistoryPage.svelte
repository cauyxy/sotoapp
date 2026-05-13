<script lang="ts">
  import { onDestroy } from "svelte";

  import PageHeader from "../../shared/ui/PageHeader.svelte";
  import PageFilterRow from "../../shared/ui/PageFilterRow.svelte";
  import SearchToggle from "../../shared/ui/SearchToggle.svelte";
  import { canonicalModeLabel } from "../../shared/modes";
  import { EMPTY_HISTORY_KEY } from "./constants";
  import { historyStore } from "../../ipc/historyStore";
  import {
    historyDesignGroups,
    historyFilterChips,
    type HistoryDesignRow
  } from "../../ipc/history";
  import { t, translate } from "../../i18n";
  import { toast } from "../../shared/ui/toast";

  let query = $state("");
  let filterId = $state("all");
  let now = $state(new Date());

  // Buckets ("today" / "yesterday" / "monthDay") only flip at local midnight.
  // The previous 60-second interval forced a full re-derive every minute even
  // though no record actually changed buckets. Schedule a single timer to the
  // next midnight, recurse from there.
  let midnightTimer: number | undefined;
  function scheduleMidnightRebucket() {
    const next = new Date();
    next.setHours(24, 0, 1, 0);
    const delay = Math.max(60_000, next.getTime() - Date.now());
    midnightTimer = window.setTimeout(() => {
      now = new Date();
      scheduleMidnightRebucket();
    }, delay);
  }
  scheduleMidnightRebucket();
  onDestroy(() => {
    if (midnightTimer !== undefined) window.clearTimeout(midnightTimer);
  });

  const filterPills = $derived(
    historyFilterChips($historyStore).map((chip) => ({
      id: chip.id,
      label:
        chip.kind === "all" ? $t("history.filterAll") : canonicalModeLabel(translate, chip.modeId),
      count: chip.count
    }))
  );
  const groups = $derived(historyDesignGroups($historyStore, now, filterId, query));
  const empty = $derived(groups.every((group) => group.rows.length === 0));

  async function copyRecord(row: HistoryDesignRow) {
    try {
      await navigator.clipboard.writeText(row.polished);
    } catch (error) {
      console.error("history: clipboard write failed", error);
      toast($t("history.copyFailed"));
    }
  }
</script>

<main class="page">
  <PageHeader title={$t("history.pageTitle")} />
  <PageFilterRow
    pills={filterPills}
    activeId={filterId}
    onSelect={(id) => (filterId = id)}
  >
    {#snippet actions()}
      <SearchToggle
        bind:query
        placeholder={$t("history.searchPlaceholder")}
        ariaOpen={$t("history.searchAria")}
        ariaClose={$t("history.searchClose")}
      />
    {/snippet}
  </PageFilterRow>
  {#if empty}
    <section class="group">
      <div class="group-title">{$t("history.groupTitle")}</div>
      <div class="empty">
        {query.trim() || filterId !== "all" ? $t("history.empty.noMatches") : $t(EMPTY_HISTORY_KEY.body)}
      </div>
    </section>
  {:else}
    {#each groups as group (`${group.primaryKind}|${group.primaryMonth ?? ""}|${group.primaryDay ?? ""}|${group.date}`)}
      {@const primaryLabel = group.primaryKind === "today"
        ? $t("history.bucket.today")
        : group.primaryKind === "yesterday"
          ? $t("history.bucket.yesterday")
          : group.primaryKind === "monthDay" && group.primaryMonth && group.primaryDay
            ? $t("history.bucket.monthDay", { month: group.primaryMonth, day: group.primaryDay })
            : $t("common.em")}
      <section class="history-design-group">
        <header class="history-design-head">
          <span class="history-design-primary">{primaryLabel}</span>
          <span class="history-design-date">{group.date}</span>
        </header>
        {#each group.rows as row (row.id)}
          <article class="history-design-row">
            <div class="history-design-meta">
              <span>{row.time}</span>
              <span>·</span>
              <span>{row.duration}</span>
              <span>·</span>
              <span>{$t("history.chars", { count: row.chars })}</span>
              <span>·</span>
              <span class="history-design-mode">{canonicalModeLabel(translate, row.mode)}</span>
              <span class="history-design-actions">
                <button type="button" class="history-link" onclick={() => void copyRecord(row)}>{$t("common.copy")}</button>
              </span>
            </div>
            <div class="history-design-polished">{row.polished}</div>
            {#if row.raw}
              <div class="history-design-raw">
                <span class="history-design-raw-tag">{$t("history.raw")}</span>
                {row.raw}
              </div>
            {/if}
          </article>
        {/each}
      </section>
    {/each}
  {/if}
</main>
