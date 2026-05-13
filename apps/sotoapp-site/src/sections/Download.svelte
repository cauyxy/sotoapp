<script lang="ts">
  import { useLatest } from "../lib/useLatest.svelte";
  import { ICONS } from "../lib/icons";

  const RELEASES_URL = "https://github.com/cauyxy/sotoapp/releases";
  const latest = useLatest();
</script>

<section id="download" class="px-6 py-24">
  <div class="max-w-5xl mx-auto">
    <header class="text-center">
      <h2 class="text-3xl md:text-4xl font-bold tracking-tight">Get Soto</h2>
      <p class="mt-2 text-ink-dim text-sm">
        {#if latest.value.status === "ok"}
          Latest build · <span class="font-mono">v{latest.value.version}</span>
        {:else if latest.value.status === "loading"}
          Latest build · …
        {:else}
          Couldn't reach updater — try the GitHub Releases page below.
        {/if}
      </p>
    </header>

    <div class="mt-10 grid gap-6 md:grid-cols-2">
      <!-- macOS card -->
      <div class="rounded-2xl bg-bg-elev border border-border p-6 flex flex-col gap-4">
        <div class="flex items-center gap-3">
          <span class="block w-8 h-8 text-ink">{@html ICONS.apple}</span>
          <div>
            <div class="font-semibold">macOS</div>
            <div class="text-ink-soft text-xs">Apple Silicon</div>
          </div>
        </div>
        <div class="font-mono text-xs text-ink-dim break-all min-h-[1lh]">
          {#if latest.value.status === "ok"}
            {latest.value.platforms["darwin-aarch64"].fileName}
          {/if}
        </div>
        {#if latest.value.status === "ok"}
          <a
            href={latest.value.platforms["darwin-aarch64"].url}
            download
            class="mt-auto inline-flex items-center justify-center gap-2 px-4 py-3 rounded-full bg-accent text-bg font-semibold hover:opacity-90 transition"
          >
            <span class="w-4 h-4">{@html ICONS.download}</span>
            Download .dmg
          </a>
        {:else if latest.value.status === "loading"}
          <button
            type="button"
            disabled
            class="mt-auto inline-flex items-center justify-center px-4 py-3 rounded-full bg-bg-elev border border-border text-ink-soft font-semibold cursor-not-allowed"
          >
            Loading…
          </button>
        {:else}
          <a
            href={RELEASES_URL}
            target="_blank"
            rel="noopener noreferrer"
            class="mt-auto inline-flex items-center justify-center gap-2 px-4 py-3 rounded-full border border-border text-ink font-semibold hover:border-accent transition"
          >
            Visit GitHub Releases
            <span class="w-3 h-3">{@html ICONS.arrowUpRight}</span>
          </a>
        {/if}
      </div>

      <!-- Windows card -->
      <div class="rounded-2xl bg-bg-elev border border-border p-6 flex flex-col gap-4">
        <div class="flex items-center gap-3">
          <span class="block w-8 h-8 text-ink">{@html ICONS.windows}</span>
          <div>
            <div class="font-semibold">Windows</div>
            <div class="text-ink-soft text-xs">x64 · Windows 11</div>
          </div>
        </div>
        <div class="font-mono text-xs text-ink-dim break-all min-h-[1lh]">
          {#if latest.value.status === "ok"}
            {latest.value.platforms["windows-x86_64"].fileName}
          {/if}
        </div>
        {#if latest.value.status === "ok"}
          <a
            href={latest.value.platforms["windows-x86_64"].url}
            download
            class="mt-auto inline-flex items-center justify-center gap-2 px-4 py-3 rounded-full bg-accent text-bg font-semibold hover:opacity-90 transition"
          >
            <span class="w-4 h-4">{@html ICONS.download}</span>
            Download .exe
          </a>
        {:else if latest.value.status === "loading"}
          <button
            type="button"
            disabled
            class="mt-auto inline-flex items-center justify-center px-4 py-3 rounded-full bg-bg-elev border border-border text-ink-soft font-semibold cursor-not-allowed"
          >
            Loading…
          </button>
        {:else}
          <a
            href={RELEASES_URL}
            target="_blank"
            rel="noopener noreferrer"
            class="mt-auto inline-flex items-center justify-center gap-2 px-4 py-3 rounded-full border border-border text-ink font-semibold hover:border-accent transition"
          >
            Visit GitHub Releases
            <span class="w-3 h-3">{@html ICONS.arrowUpRight}</span>
          </a>
        {/if}
      </div>
    </div>

    <p class="mt-6 text-center text-ink-soft text-sm">
      Or grab any build on
      <a
        href={RELEASES_URL}
        target="_blank"
        rel="noopener noreferrer"
        class="text-ink-dim hover:text-accent inline-flex items-center gap-1"
      >
        GitHub Releases
        <span class="w-3 h-3 inline-block">{@html ICONS.arrowUpRight}</span>
      </a>
    </p>
  </div>
</section>
