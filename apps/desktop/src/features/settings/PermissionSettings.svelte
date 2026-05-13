<script lang="ts">
  import { onMount } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";

  import { toast } from "../../shared/ui/toast";
  import {
    listPermissionStatuses,
    mergePermissionStatus,
    requestPermissionAuthorization,
    permissionStatusRows,
    permissionStatusesAreSatisfied,
    subscribePermissionUpdates,
    type PermissionSettingsPane,
    type PermissionStatusRecord
  } from "../../ipc/settings";
  import { t } from "../../i18n";

  const PERMISSION_LABEL_KEY: Record<PermissionSettingsPane, { title: string; actionLabel: string }> = {
    microphone: {
      title: "onboarding.permissions.microphoneTitle",
      actionLabel: "onboarding.permissions.microphoneAction"
    },
    accessibility: {
      title: "onboarding.permissions.accessibilityTitle",
      actionLabel: "onboarding.permissions.accessibilityAction"
    }
  };

  function permissionActionLabelKey(row: { pane: PermissionSettingsPane; kind: string }) {
    if (row.pane === "microphone" && (row.kind === "denied" || row.kind === "restricted")) {
      return "onboarding.permissions.microphoneSettingsAction";
    }
    return PERMISSION_LABEL_KEY[row.pane].actionLabel;
  }

  let permissionStatuses = $state<PermissionStatusRecord[]>([]);
  let permissionMessage = $state<string>($t("onboarding.permissions.msg.checking"));
  let openingPane = $state<PermissionSettingsPane | null>(null);
  const permissionRows = $derived(permissionStatusRows(permissionStatuses));

  async function refreshPermissionStatuses() {
    try {
      const nextStatuses = await listPermissionStatuses();
      permissionStatuses = nextStatuses;
      permissionMessage = permissionStatusesAreSatisfied(nextStatuses)
        ? $t("onboarding.permissions.msg.ready")
        : $t("onboarding.permissions.msg.review");
    } catch (error) {
      permissionMessage = error instanceof Error ? error.message : $t("onboarding.permissions.msg.unavailable");
    }
  }

  async function openPermission(pane: PermissionSettingsPane) {
    try {
      openingPane = pane;
      const updated = await requestPermissionAuthorization(pane);
      permissionStatuses = mergePermissionStatus(permissionStatuses, updated);
      permissionMessage = permissionStatusesAreSatisfied(permissionStatuses)
        ? $t("onboarding.permissions.msg.ready")
        : `${$t("onboarding.permissions.msg.opened", { pane: $t(PERMISSION_LABEL_KEY[pane].title) })} ${$t("onboarding.permissions.msg.refreshHint")}`;
    } catch (error) {
      permissionMessage = error instanceof Error ? error.message : $t("onboarding.permissions.msg.openFailed");
      toast(permissionMessage);
    } finally {
      openingPane = null;
    }
  }

  onMount(() => {
    void refreshPermissionStatuses();
    let disposed = false;
    const cleanups: Array<() => void> = [];

    void subscribePermissionUpdates(() => {
      void refreshPermissionStatuses();
    })
      .then((unlisten) => {
        if (disposed) unlisten();
        else cleanups.push(unlisten);
      })
      .catch((error) => console.warn("[soto-fe] permission update listen failed:", error));

    // Refresh immediately when the app regains focus so that granting a
    // permission in System Settings and switching back shows the updated
    // state without waiting for the background poller.
    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused) void refreshPermissionStatuses();
      })
      .then((unlisten) => {
        if (disposed) unlisten();
        else cleanups.push(unlisten);
      })
      .catch((error) => console.warn("[soto-fe] permission focus listen failed:", error));

    return () => {
      disposed = true;
      for (const fn of cleanups) fn();
    };
  });
</script>

{#snippet glyph(pane: PermissionSettingsPane)}
  {#if pane === "microphone"}
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11 a6.5 6.5 0 0 0 13 0" />
      <path d="M12 17.5 V21" />
      <path d="M8.5 21 H15.5" />
    </svg>
  {:else}
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="4.5" r="1.7" />
      <path d="M4 9 H20" />
      <path d="M12 8 V13.5" />
      <path d="M8 20.5 L12 13.5 L16 20.5" />
    </svg>
  {/if}
{/snippet}

<div class="group permission-strip">
  <div class="permission-icons">
    {#each permissionRows as row (row.pane)}
      {@const labels = PERMISSION_LABEL_KEY[row.pane]}
      {#if row.isSatisfied}
        <span
          class="permission-icon"
          data-tone={row.tone}
          title={$t(labels.title)}
          aria-label={`${$t(labels.title)}: ${row.statusLabel}`}
        >
          {@render glyph(row.pane)}
        </span>
      {:else}
        <button
          type="button"
          class="permission-icon"
          data-tone={row.tone}
          disabled={openingPane === row.pane}
          title={openingPane === row.pane ? $t("onboarding.permissions.openingAction") : $t(permissionActionLabelKey(row))}
          aria-label={`${$t(labels.title)}: ${$t(permissionActionLabelKey(row))}`}
          onclick={() => void openPermission(row.pane)}
        >
          {@render glyph(row.pane)}
        </button>
      {/if}
    {/each}
  </div>
  <span class="permission-status">{permissionMessage}</span>
  <button type="button" class="permission-refresh" onclick={() => void refreshPermissionStatuses()}>
    {$t("onboarding.permissions.refreshStatus")}
  </button>
</div>
