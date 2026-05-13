<script lang="ts">
  import SotoMark from "../shared/ui/SotoMark.svelte";
  import ToastHost from "../shared/ui/ToastHost.svelte";
  import { listenWithCleanup } from "../shared/listenWithCleanup";
  import { VOICE_RUNTIME_EVENT, type VoiceRuntimeEvent } from "../shared/voice";
  import type { NavItem } from "../shared/nav";
  import { appSettingsReady } from "./bootstrap";
  import { refreshHistoryRecords } from "../ipc/historyStore";
  import Sidebar from "./Sidebar.svelte";
  import WindowControls from "./WindowControls.svelte";
  import HomePage from "../features/home/HomePage.svelte";
  import HistoryPage from "../features/history/HistoryPage.svelte";
  import ModesPage from "../features/modes/ModesPage.svelte";
  import DictionaryPage from "../features/dictionary/DictionaryPage.svelte";
  import SettingsPage from "../features/settings/SettingsPage.svelte";
  import { translate } from "../i18n";

  let active = $state<NavItem>("Home");
  let visited = $state(new Set<NavItem>(["Home"]));
  let launchChecked = $state(false);
  let launchMessage = $state<string>(translate("onboarding.launch.loading"));

  function setActive(item: NavItem) {
    active = item;
    if (!visited.has(item)) {
      const next = new Set(visited);
      next.add(item);
      visited = next;
    }
  }

  // Telemetry listeners for hotkey + voice-runtime events. Co-located in a
  // `$effect` so cleanup runs automatically on destroy and there's no
  // "in-flight `.then` after unmount" race.
  $effect(() =>
    listenWithCleanup(
      "soto://hotkey-runtime-action",
      (event) => {
        console.debug("[soto-fe] event hotkey-runtime-action:", event.payload);
      },
      {
        onError: (error) => {
          console.debug("[soto-fe] listen hotkey-runtime-action failed:", error);
        }
      }
    )
  );

  // Keep historyStore live. Boot hydrates it once from get_app_snapshot;
  // without this, new sessions don't show up until restart. The terminal
  // voice-runtime kinds (`completed` / `cancelled` / `failed`) correspond
  // 1:1 with append_history calls in soto-session.
  $effect(() =>
    listenWithCleanup<VoiceRuntimeEvent>(
      VOICE_RUNTIME_EVENT,
      (event) => {
        const kind = event.payload?.kind;
        if (kind === "completed" || kind === "cancelled" || kind === "failed") {
          void refreshHistoryRecords().catch((error) => {
            console.debug("[soto-fe] refreshHistoryRecords failed:", error);
          });
        }
      },
      { onError: (error) => console.debug("[soto-fe] listen history-refresh failed:", error) }
    )
  );

  // Wait for the shared snapshot so the chrome doesn't flash before settings
  // load; we no longer route through any first-run onboarding.
  $effect(() => {
    let cancelled = false;
    void appSettingsReady().then((settings) => {
      if (cancelled) return;
      launchMessage = settings
        ? translate("onboarding.launch.ready")
        : translate("onboarding.launch.unavailable");
      launchChecked = true;
    });
    return () => {
      cancelled = true;
    };
  });
</script>

<div class="titlebar" data-tauri-drag-region>
  <WindowControls />
</div>

{#if !launchChecked}
  <main class="onboarding-shell">
    <SotoMark />
    <div class="status-note">{launchMessage}</div>
  </main>
{:else}
  <div class="app-shell">
    <Sidebar {active} onSelect={setActive} />
    <div class="app-shell-content">
      {#if visited.has("Home")}
        <div class="app-shell-pane" hidden={active !== "Home"}>
          <HomePage onViewHistory={() => setActive("History")} />
        </div>
      {/if}
      {#if visited.has("History")}
        <div class="app-shell-pane" hidden={active !== "History"}>
          <HistoryPage />
        </div>
      {/if}
      {#if visited.has("Dictionary")}
        <div class="app-shell-pane" hidden={active !== "Dictionary"}>
          <DictionaryPage />
        </div>
      {/if}
      {#if visited.has("Modes")}
        <div class="app-shell-pane" hidden={active !== "Modes"}>
          <ModesPage isActive={active === "Modes"} />
        </div>
      {/if}
      {#if visited.has("Settings")}
        <div class="app-shell-pane" hidden={active !== "Settings"}>
          <SettingsPage />
        </div>
      {/if}
    </div>
  </div>
{/if}

<ToastHost />
