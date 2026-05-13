<script lang="ts">
  let {
    label,
    value,
    unit,
    accent = false
  }: { label: string; value: string; unit: string; accent?: boolean } = $props();
</script>

<div class={`stat-tile${accent ? " accent" : ""}`}>
  <span class="stat-tile-label">{label}</span>
  <div class="stat-tile-value">
    <strong>{value}</strong>
    <span class="stat-tile-unit">{unit}</span>
  </div>
</div>
