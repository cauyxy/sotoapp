<script lang="ts">
  import NavIcon from "../shared/ui/NavIcon.svelte";
  import SotoMark from "../shared/ui/SotoMark.svelte";
  import UtilIcon from "../shared/ui/UtilIcon.svelte";
  import { NAV_LABEL_KEY, type NavItem } from "../shared/nav";
  import { nextTheme, themeIconName, type Theme } from "../shared/theme";
  import { t } from "../i18n";

  let { active, onSelect }: { active: NavItem; onSelect: (item: NavItem) => void } = $props();

  const primary: NavItem[] = ["Home", "History", "Dictionary", "Modes"];
  let theme = $state<Theme>("system");

  $effect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  });

  function cycleTheme() {
    theme = nextTheme(theme);
  }
</script>

<aside class="sidebar">
  <div class="brand brand-italic">
    <SotoMark size={28} />
    <span class="brand-word">Soto</span>
  </div>
  <nav class="nav" aria-label="Primary">
    {#each primary as item (item)}
      <button
        type="button"
        class={active === item ? "active" : ""}
        onclick={() => onSelect(item)}
      >
        <NavIcon name={item} />
        <span>{$t(NAV_LABEL_KEY[item])}</span>
      </button>
    {/each}
  </nav>
  <div class="sidebar-divider"></div>
  <nav class="nav nav-secondary" aria-label="Secondary">
    <button
      type="button"
      class={active === "Settings" ? "active" : ""}
      onclick={() => onSelect("Settings")}
    >
      <NavIcon name="Settings" />
      <span>{$t(NAV_LABEL_KEY.Settings)}</span>
    </button>
  </nav>
  <div class="sidebar-spacer"></div>
  <div class="util-row">
    <button type="button" class="util-btn" aria-label={$t("sidebar.helpAria")} onclick={() => onSelect("Settings")}>
      <UtilIcon name="help" />
    </button>
    <button type="button" class="util-btn" aria-label={$t("sidebar.feedbackAria")} onclick={() => onSelect("Settings")}>
      <UtilIcon name="chat" />
    </button>
    <button type="button" class="util-btn" aria-label={$t("sidebar.themeAria", { theme })} onclick={cycleTheme}>
      <UtilIcon name={themeIconName(theme)} />
    </button>
  </div>
</aside>
