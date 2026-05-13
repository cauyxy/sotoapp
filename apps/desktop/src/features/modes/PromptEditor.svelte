<script lang="ts">
  import type { Snippet } from "svelte";
  import { t } from "../../i18n";

  type PromptStatus = "empty" | "loading" | "ready" | "error";

  let {
    value,
    onChange,
    status = "ready",
    errorMessage = null,
    onRetry,
    topControls
  }: {
    value: string;
    onChange: (next: string) => void;
    status?: PromptStatus;
    errorMessage?: string | null;
    onRetry?: () => void;
    topControls?: Snippet;
  } = $props();
</script>

<div class="prompt-editor">
  <header class="prompt-editor-head">
    <span class="prompt-editor-mark">—</span>
    <span class="prompt-editor-title">{$t("modes.promptTitle")}</span>
    <span class="prompt-editor-spacer"></span>
  </header>
  {#if topControls}<div class="prompt-editor-top-controls">{@render topControls()}</div>{/if}
  {#if status === "loading"}
    <div class="prompt-editor-loading" aria-live="polite">{$t("modes.promptLoading")}</div>
    <textarea
      class="prompt-editor-body"
      value={value}
      disabled
      spellcheck="false"
    ></textarea>
  {:else if status === "error"}
    <div class="prompt-editor-error" role="alert">
      <p>{errorMessage ?? $t("modes.promptLoadError")}</p>
      {#if onRetry}
        <button type="button" onclick={onRetry}>{$t("modes.promptRetry")}</button>
      {/if}
    </div>
  {:else}
    <textarea
      class="prompt-editor-body"
      {value}
      disabled={status === "empty"}
      oninput={(event) => onChange((event.target as HTMLTextAreaElement).value)}
      spellcheck="false"
    ></textarea>
  {/if}
</div>
