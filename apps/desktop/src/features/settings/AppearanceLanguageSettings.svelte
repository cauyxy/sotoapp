<script lang="ts">
  import { onDestroy } from "svelte";

  import { changeLanguage } from "../../i18n";
  import { resolveLocale } from "../../i18n/resolveLocale";
  import {
    LOCALE_REGISTRY,
    SUPPORTED_LOCALES,
    type LocalePreference
  } from "../../i18n/types";
  import type { Theme } from "../../shared/theme";
  import {
    getAppSettings,
    saveAppSettings,
    type AppSettings
  } from "../../ipc/settings";
  import { t } from "../../i18n";
  import { toast } from "../../shared/ui/toast";

  type AppearancePatch = Partial<Pick<AppSettings, "locale" | "theme">>;

  let settings = $state<AppSettings | null>(null);
  let cancelled = false;

  void (async () => {
    try {
      const next = await getAppSettings();
      if (cancelled) return;
      settings = next;
    } catch (error) {
      console.error("settings/appearance: failed to load", error);
    }
  })();

  onDestroy(() => {
    cancelled = true;
  });

  async function applyPatch(patch: AppearancePatch) {
    if (!settings) return;
    const prev = settings;
    const next: AppSettings = { ...settings, ...patch };
    settings = next;
    if (patch.theme !== undefined) {
      document.documentElement.setAttribute("data-theme", patch.theme);
    }
    try {
      const saved = await saveAppSettings(next);
      settings = saved;
      document.documentElement.setAttribute("data-theme", saved.theme);
      if (patch.locale !== undefined) {
        await changeLanguage(resolveLocale(saved.locale as LocalePreference));
      }
    } catch (error) {
      console.error("settings/appearance: failed to save", error);
      settings = prev;
      document.documentElement.setAttribute("data-theme", prev.theme);
      toast($t("settings.appearance.saveFailed"));
    }
  }

  const theme = $derived((settings?.theme ?? "system") as Theme);
  const themeOptions: Theme[] = ["system", "light", "dark"];
  const localeOptions: LocalePreference[] = ["system", ...SUPPORTED_LOCALES];
  const locale = $derived((settings?.locale ?? "system") as LocalePreference);
</script>

<div class="group">
  <div class="setting-row">
    <span class="setting-row-label">{$t("settings.appearance.theme")}</span>
    <div class="segmented" role="tablist" aria-label={$t("settings.appearance.theme")}>
      {#each themeOptions as option (option)}
        <button
          type="button"
          role="tab"
          aria-selected={option === theme}
          class={option === theme ? "active" : ""}
          onclick={() => void applyPatch({ theme: option })}
        >
          {option === "system"
            ? $t("settings.appearance.themeSystem")
            : option === "light"
              ? $t("settings.appearance.themeLight")
              : $t("settings.appearance.themeDark")}
        </button>
      {/each}
    </div>
  </div>
  {#if settings}
    <div class="setting-row">
      <span class="setting-row-label">{$t("settings.appearance.interfaceLanguage")}</span>
      <div class="segmented" role="tablist" aria-label={$t("settings.appearance.interfaceLanguage")}>
        {#each localeOptions as option (option)}
          <button
            type="button"
            role="tab"
            aria-selected={option === locale}
            class={option === locale ? "active" : ""}
            onclick={() => void applyPatch({ locale: option })}
          >
            {option === "system"
              ? $t("settings.appearance.systemLocale")
              : LOCALE_REGISTRY[option].nativeName}
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>
