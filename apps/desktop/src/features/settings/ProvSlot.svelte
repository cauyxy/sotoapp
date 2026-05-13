<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    label,
    active,
    disabledHint,
    headerRight,
    children
  }: {
    label: string;
    active: boolean;
    disabledHint?: string;
    headerRight?: Snippet;
    children?: Snippet;
  } = $props();
</script>

<section class={`prov-slot${active ? " active" : " dimmed"}`}>
  <header class="prov-slot-head">
    <h3 class="prov-slot-title">{label}</h3>
    {#if headerRight}<span class="prov-slot-head-actions">{@render headerRight()}</span>{/if}
  </header>
  {#if disabledHint}<p class="prov-slot-disabled-hint">{disabledHint}</p>{/if}
  <div class="prov-slot-body">{#if children}{@render children()}{/if}</div>
</section>
