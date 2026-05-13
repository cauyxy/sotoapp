<script lang="ts">
  let {
    kicker,
    title,
    sub
  }: { kicker?: string; title: string; sub?: string } = $props();
</script>

<header class="page-header">
  {#if kicker}<div class="kicker">{kicker}</div>{/if}
  <div class="title-line">
    <h1>{title}</h1>
  </div>
  {#if sub}<p>{sub}</p>{/if}
</header>
