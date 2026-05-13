<script lang="ts">
  import KeyCombo from "./KeyCombo.svelte";
  import { t } from "../../i18n";

  let {
    chord,
    capturing,
    onStartCapture
  }: { chord: string; capturing: boolean; onStartCapture: () => void } = $props();

  let hover = $state(false);
</script>

<button
  type="button"
  class={`trigger-editor${hover || capturing ? " hover" : ""}${capturing ? " capturing" : ""}`}
  onmouseenter={() => (hover = true)}
  onmouseleave={() => (hover = false)}
  onclick={onStartCapture}
>
  <span class="trigger-editor-label">{$t("modes.shortcut")}</span>
  {#if capturing}
    <span class="trigger-editor-capturing">
      <span class="dot dot-ok dot-pulse" aria-hidden="true"></span>
      {$t("modes.shortcutCapture")}
    </span>
  {:else if chord}
    <KeyCombo {chord} />
  {:else}
    <span class="trigger-editor-empty">{$t("modes.shortcutEmpty")}</span>
  {/if}
</button>
