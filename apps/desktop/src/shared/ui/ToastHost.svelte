<script lang="ts">
  import { toasts$ } from "./toast";
</script>

{#if $toasts$.length > 0}
  <div class="toast-host">
    {#each $toasts$ as item (item.id)}
      <div class="toast">{item.text}</div>
    {/each}
  </div>
{/if}
