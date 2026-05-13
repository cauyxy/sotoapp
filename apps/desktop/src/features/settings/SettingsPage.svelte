<script lang="ts">
  import PageHeader from "../../shared/ui/PageHeader.svelte";
  import { SETTINGS_SECTIONS, SETTINGS_SECTION_LABEL_KEY, type SettingsSection } from "./constants";
  import AboutSettings from "./AboutSettings.svelte";
  import AppearanceLanguageSettings from "./AppearanceLanguageSettings.svelte";
  import Engine from "./Engine.svelte";
  import MicrophoneSettings from "./MicrophoneSettings.svelte";
  import NetworkSettings from "./NetworkSettings.svelte";
  import PermissionSettings from "./PermissionSettings.svelte";
  import { isMacOS } from "../../app/platform";
  import { t } from "../../i18n";

  const showPermissions = isMacOS();

  const labels = $derived<Record<SettingsSection, string>>(
    Object.fromEntries(
      SETTINGS_SECTIONS.map((s) => [s, $t(SETTINGS_SECTION_LABEL_KEY[s])])
    ) as Record<SettingsSection, string>
  );
</script>

<main class="page settings-page">
  <div class="settings-flow">
    <div class="settings-flow-content">
      <PageHeader title={$t("settings.page.title")} />

      {#if showPermissions}
        <section class="settings-section">
          <header class="settings-section-head">
            <span class="settings-section-mark">—</span>
            <h2>{labels.Permissions}</h2>
          </header>
          <PermissionSettings />
        </section>
      {/if}

      <section class="settings-section">
        <header class="settings-section-head">
          <span class="settings-section-mark">—</span>
          <h2>{labels.Microphone}</h2>
        </header>
        <MicrophoneSettings />
      </section>

      <section class="settings-section">
        <header class="settings-section-head">
          <span class="settings-section-mark">—</span>
          <h2>{labels.Engine}</h2>
        </header>
        <Engine />
      </section>

      <section class="settings-section">
        <header class="settings-section-head">
          <span class="settings-section-mark">—</span>
          <h2>{labels["Network"]}</h2>
        </header>
        <NetworkSettings />
      </section>

      <section class="settings-section">
        <header class="settings-section-head">
          <span class="settings-section-mark">—</span>
          <h2>{labels["Appearance & Language"]}</h2>
        </header>
        <AppearanceLanguageSettings />
      </section>

      <section class="settings-section">
        <header class="settings-section-head">
          <span class="settings-section-mark">—</span>
          <h2>{labels.About}</h2>
        </header>
        <AboutSettings />
      </section>
    </div>
  </div>
</main>
