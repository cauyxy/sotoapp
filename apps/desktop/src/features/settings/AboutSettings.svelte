<script lang="ts">
  import { getVersion } from "@tauri-apps/api/app";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { relaunch } from "@tauri-apps/plugin-process";
  import type { Update } from "@tauri-apps/plugin-updater";
  import { onMount } from "svelte";

  import { t } from "../../i18n";
  import SotoMark from "../../shared/ui/SotoMark.svelte";
  import { toast } from "../../shared/ui/toast";
  import {
    aboutPanel,
    checkForUpdates,
    updateStatusMessage,
    type AboutPanel,
    type UpdateStatus
  } from "./about.ipc";

  let version = $state<string | null>(null);
  let updateStatus = $state<UpdateStatus>("idle");
  let pendingUpdate = $state<Update | null>(null);
  let panel = $derived<AboutPanel | null>(version ? aboutPanel({ version }) : null);

  async function loadVersion() {
    try {
      version = await getVersion();
    } catch (error) {
      version = null;
      console.error("settings/about: failed to load app version", error);
    }
  }

  async function handleCheckUpdate() {
    updateStatus = "checking";
    pendingUpdate = null;
    try {
      const update = await checkForUpdates();
      if (update?.available) {
        updateStatus = "available";
        pendingUpdate = update;
      } else {
        updateStatus = "up-to-date";
      }
    } catch (error) {
      console.error("settings/about: update check failed", error);
      updateStatus = "failed";
    }
  }

  async function installUpdate() {
    if (!pendingUpdate) return;
    updateStatus = "installing";
    try {
      await pendingUpdate.downloadAndInstall();
      await relaunch();
    } catch (error) {
      console.error("settings/about: install failed", error);
      updateStatus = "failed";
    }
  }

  async function openRepository(event: MouseEvent) {
    event.preventDefault();
    if (!panel) return;

    try {
      await openUrl(panel.repositoryUrl);
    } catch (error) {
      console.error("settings/about: failed to open repository", error);
      toast($t("settings.about.openRepoFailed"));
    }
  }

  onMount(() => {
    void loadVersion();
  });
</script>

<div class="group about-card">
  {#if panel}
    <section class="about-hero">
      <span class="about-hero-glyph">
        <SotoMark size={48} />
      </span>
      <div class="about-hero-name">{panel.appName}</div>
      <div class="about-hero-version">
        {$t("settings.about.versionLine", { version: panel.versionLabel })}
      </div>
      <div class="about-hero-tagline">{$t("settings.about.tagline")}</div>
    </section>
    <div class="about-divider"></div>
    <div class="about-actions">
      {#if updateStatus === "idle"}
        <button class="about-action-btn" type="button" onclick={handleCheckUpdate}>
          {$t("settings.about.checkUpdate")}
        </button>
      {:else if updateStatus === "available"}
        <span class="about-update-note">
          {$t("settings.about.updateAvailable", { version: pendingUpdate?.version ?? "" })}
        </span>
        <button class="about-action-btn" type="button" onclick={installUpdate}>
          {$t("settings.about.installUpdate")}
        </button>
      {:else if updateStatus === "failed"}
        <span class="about-actions-disabled">{$t(updateStatusMessage("failed"))}</span>
        <button class="about-action-btn" type="button" onclick={handleCheckUpdate}>
          {$t("settings.about.updateRetry")}
        </button>
      {:else}
        <span class="about-actions-disabled">{$t(updateStatusMessage(updateStatus))}</span>
      {/if}
      <a class="about-repository-link" href={panel.repositoryUrl} onclick={openRepository}>
        {panel.repositoryLabel}
      </a>
    </div>
    <div class="about-signature">{$t("settings.about.signature")}</div>
  {/if}
</div>
