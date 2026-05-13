<script lang="ts">
  let {
    query = $bindable(),
    placeholder,
    ariaOpen,
    ariaClose
  }: {
    query: string;
    placeholder: string;
    ariaOpen: string;
    ariaClose: string;
  } = $props();

  let open = $state(false);

  function openSearch() {
    open = true;
  }

  function closeSearch() {
    open = false;
    query = "";
  }
</script>

{#if open}
  <div class="page-filter-search-open">
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.4 10.4 L13.5 13.5" />
    </svg>
    <!-- svelte-ignore a11y_autofocus -->
    <input autofocus aria-label={ariaOpen} bind:value={query} {placeholder} />
    <button
      type="button"
      class="page-filter-search-close"
      aria-label={ariaClose}
      onclick={closeSearch}
    >×</button>
  </div>
{:else}
  <button
    type="button"
    class="page-filter-search-icon-btn"
    aria-label={ariaOpen}
    onclick={openSearch}
  >
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.4 10.4 L13.5 13.5" />
    </svg>
  </button>
{/if}
