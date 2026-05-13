<script lang="ts">
  import StatTile from "./StatTile.svelte";
  import { t } from "../../i18n";

  let {
    speakMinutes,
    characterCount,
    savedMinutes,
    avgCpm
  }: { speakMinutes: number; characterCount: number; savedMinutes: number; avgCpm: number | null } = $props();

  const charactersStr = $derived((characterCount / 1000).toFixed(1));
  const savedStr = $derived(`${Math.floor(savedMinutes / 60)}:${String(savedMinutes % 60).padStart(2, "0")}`);
  const paceStr = $derived(avgCpm === null ? $t("common.em") : avgCpm.toString());
</script>

<section class="stats-panel">
  <header class="stats-panel-head">
    <h2>{$t("home.overview")}</h2>
    <span class="stats-panel-meta">{$t("home.overviewMeta")}</span>
  </header>
  <div class="stats-panel-grid">
    <StatTile label={$t("home.stats.speakTime")} value={speakMinutes.toString()} unit={$t("home.stats.speakTimeUnit")} />
    <StatTile label={$t("home.stats.characters")} value={charactersStr} unit={$t("home.stats.charactersUnit")} />
    <StatTile label={$t("home.stats.timeSaved")} value={savedStr} unit={$t("home.stats.timeSavedUnit")} accent />
    <StatTile label={$t("home.stats.avgPace")} value={paceStr} unit={$t("home.stats.avgPaceUnit")} />
  </div>
</section>
