<script lang="ts">
  import { onDestroy } from "svelte";

  import { currentDateKicker } from "../../shared/nav";
  import { weeklyOverview, recentTranscripts } from "./model";
  import StatsPanel from "./StatsPanel.svelte";
  import { historyStore } from "../../ipc/historyStore";
  import { t } from "../../i18n";

  let { onViewHistory }: { onViewHistory: () => void } = $props();

  let now = $state(new Date());
  const tick = window.setInterval(() => (now = new Date()), 60_000);
  onDestroy(() => window.clearInterval(tick));

  const weekdayLabels = $derived([
    $t("common.weekday.sun"),
    $t("common.weekday.mon"),
    $t("common.weekday.tue"),
    $t("common.weekday.wed"),
    $t("common.weekday.thu"),
    $t("common.weekday.fri"),
    $t("common.weekday.sat")
  ]);
  const dateKicker = $derived(currentDateKicker(now, weekdayLabels));
  const recents = $derived(recentTranscripts($historyStore, 3));
  const overview = $derived(weeklyOverview($historyStore));
</script>

<main class="page">
  <header class="home-hero">
    <div class="home-hero-row">
      <div class="home-hero-titles">
        <div class="kicker">{dateKicker}</div>
        <div class="title-line home-hero-title">
          <h1>轻声细语，雅致成文</h1>
          <span>Sotto voce, polished prose.</span>
        </div>
      </div>
    </div>
  </header>
  <div class="soto-hairline"></div>
  <StatsPanel
    speakMinutes={overview.speakMinutes}
    characterCount={overview.characterCount}
    savedMinutes={overview.savedMinutes}
    avgCpm={overview.avgCpm}
  />
  <section class="group recent-card">
    <header class="recent-card-head">
      <span class="recent-card-title">
        <span class="recent-card-zh">{$t("home.recent")}</span>
      </span>
      {#if recents.length > 0}
        <button type="button" class="recent-card-view-all" onclick={onViewHistory}>
          {$t("common.viewAll")}
        </button>
      {/if}
    </header>
    {#if recents.length === 0}
      <div class="empty">{$t("history.empty.title")}</div>
    {:else}
      <div class="recent-list">
        {#each recents as row (row.id)}
          <article class="recent-row">
            <div class="recent-meta">
              <span class="recent-time">{row.time}</span>
              <span class="recent-mode">{row.mode}</span>
            </div>
            <div class="recent-body">{row.body}</div>
            <div class="recent-chars">{$t("home.recentChars", { count: row.chars })}</div>
          </article>
        {/each}
      </div>
    {/if}
  </section>
</main>
