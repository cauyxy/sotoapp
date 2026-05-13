<script lang="ts">
  import type { Snippet } from "svelte";

  export type PageFilterMarker = "ok" | "auto" | "manual";

  export type FilterPill = {
    id: string;
    label: string;
    count?: number;
    marker?: PageFilterMarker;
  };

  let {
    pills,
    activeId,
    onSelect,
    actions
  }: {
    pills: FilterPill[];
    activeId: string;
    onSelect: (id: string) => void;
    actions?: Snippet;
  } = $props();
</script>

<div class="page-filter-row">
  <div class="page-filter-pills" role="tablist">
    {#each pills as pill (pill.id)}
      {@const active = activeId === pill.id}
      <button
        type="button"
        role="tab"
        aria-selected={active}
        class={`page-filter-pill${active ? " active" : ""}`}
        onclick={() => onSelect(pill.id)}
      >
        {#if pill.marker === "ok"}
          <span class="dot dot-ok" aria-hidden="true"></span>
        {:else if pill.marker === "auto"}
          <span class={`word-mark word-mark-${pill.marker}`} aria-hidden="true"></span>
        {:else if pill.marker === "manual"}
          <span class={`word-mark word-mark-${pill.marker}`} aria-hidden="true"></span>
        {/if}
        <span>{pill.label}</span>
        {#if pill.count !== undefined}
          <span class="page-filter-pill-count">{pill.count}</span>
        {/if}
      </button>
    {/each}
  </div>
  <div class="page-filter-actions">
    {#if actions}
      {@render actions()}
    {/if}
  </div>
</div>
