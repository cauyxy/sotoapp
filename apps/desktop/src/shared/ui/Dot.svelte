<script lang="ts">
  type Tone = "ok" | "warn" | "error" | "idle";

  let { tone = "idle", pulse = false }: { tone?: Tone; pulse?: boolean } = $props();
</script>

<span class={`dot dot-${tone}${pulse ? " dot-pulse" : ""}`} aria-hidden="true"></span>
