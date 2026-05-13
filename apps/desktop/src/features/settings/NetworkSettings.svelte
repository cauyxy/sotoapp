<script lang="ts">
  import { onDestroy } from "svelte";
  import { getAppSettings, saveAppSettings, type AppSettings } from "../../ipc/settings";
  import { t } from "../../i18n";

  let settings = $state<AppSettings | null>(null);
  let cancelled = false;

  void (async () => {
    try {
      const loaded = await getAppSettings();
      if (cancelled) return;
      settings = loaded;
    } catch (error) {
      console.error("settings/network: failed to load", error);
    }
  })();

  onDestroy(() => { cancelled = true; });

  async function toggle() {
    if (!settings) return;
    const next: AppSettings = { ...settings, use_proxy: !settings.use_proxy };
    settings = next;
    try {
      settings = await saveAppSettings(next);
    } catch (error) {
      console.error("settings/network: failed to save", error);
      settings = { ...next, use_proxy: !next.use_proxy };
    }
  }
</script>

<div class="group">
  <div class="setting-row">
    <span class="setting-row-label">{$t("settings.network.useProxy")}</span>
    <button
      type="button"
      role="switch"
      aria-checked={settings?.use_proxy ?? true}
      aria-label={$t("settings.network.useProxy")}
      class="toggle {(settings?.use_proxy ?? true) ? 'toggle--on' : ''}"
      onclick={() => void toggle()}
      disabled={settings === null}
    >
      <span class="toggle-thumb"></span>
    </button>
  </div>
  <p class="setting-hint">{$t("settings.network.useProxyHint")}</p>
</div>

<style>
  .setting-hint {
    margin: 0;
    font-size: 11px;
    color: var(--text-secondary, rgba(128, 128, 128, 0.7));
    line-height: 1.4;
  }

  .toggle {
    position: relative;
    width: 36px;
    height: 20px;
    border-radius: 10px;
    border: none;
    background: var(--toggle-off, rgba(128, 128, 128, 0.3));
    cursor: pointer;
    padding: 0;
    transition: background 0.2s;
    flex-shrink: 0;
  }

  .toggle--on {
    background: var(--accent, #5b8cff);
  }

  .toggle-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: white;
    transition: transform 0.2s;
  }

  .toggle--on .toggle-thumb {
    transform: translateX(16px);
  }

  .toggle:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
