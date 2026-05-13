<script lang="ts">
  import { onDestroy } from "svelte";
  import { getCurrentWindow, type Window as TauriWindow } from "@tauri-apps/api/window";

  import { createWindowControlActions } from "./windowActions";
  import { isMacOS } from "./platform";

  const macOS = isMacOS();
  let win: TauriWindow | null = null;

  if (!macOS) {
    try {
      win = getCurrentWindow();
    } catch {
      win = null;
    }
  }

  const actions = win ? createWindowControlActions(win) : null;

  let maximized = $state(false);
  let focused = $state(true);
  const cleanups: Array<() => void> = [];
  let disposed = false;

  if (win) {
    void win
      .isMaximized()
      .then((value) => {
        if (!disposed) maximized = value;
      })
      .catch((error) => console.warn("[soto-fe] WindowControls: isMaximized failed:", error));

    void win
      .onResized(() => {
        win
          ?.isMaximized()
          .then((value) => {
            if (!disposed) maximized = value;
          })
          .catch((error) => console.warn("[soto-fe] WindowControls: isMaximized (resize) failed:", error));
      })
      .then((unlisten) => {
        if (disposed) unlisten();
        else cleanups.push(unlisten);
      })
      .catch((error) => console.warn("[soto-fe] WindowControls: onResized listen failed:", error));

    void win
      .onFocusChanged(({ payload }) => {
        if (!disposed) focused = Boolean(payload);
      })
      .then((unlisten) => {
        if (disposed) unlisten();
        else cleanups.push(unlisten);
      })
      .catch((error) => console.warn("[soto-fe] WindowControls: onFocusChanged listen failed:", error));
  }

  onDestroy(() => {
    disposed = true;
    for (const fn of cleanups) fn();
  });
</script>

{#if actions}
  <div class={focused ? "window-controls" : "window-controls window-controls-blur"} aria-label="Window controls">
    <button type="button" class="window-btn" aria-label="Minimize" onclick={() => void actions.minimize()}>
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M0 5 H10" stroke="currentColor" stroke-width="1" />
      </svg>
    </button>
    <button
      type="button"
      class="window-btn"
      aria-label={maximized ? "Restore" : "Maximize"}
      onclick={() => void actions.toggleMaximize()}
    >
      {#if maximized}
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" fill="none">
          <rect x="0.5" y="2.5" width="7" height="7" stroke="currentColor" stroke-width="1" />
          <path d="M2.5 2.5 V0.5 H9.5 V7.5 H7.5" stroke="currentColor" stroke-width="1" fill="none" />
        </svg>
      {:else}
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" fill="none">
          <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" stroke-width="1" />
        </svg>
      {/if}
    </button>
    <button type="button" class="window-btn window-btn-close" aria-label="Close" onclick={() => void actions.close()}>
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M0 0 L10 10 M10 0 L0 10" stroke="currentColor" stroke-width="1" stroke-linecap="square" />
      </svg>
    </button>
  </div>
{/if}
