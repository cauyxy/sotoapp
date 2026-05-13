<script lang="ts">
  import Capsule from "../lib/Capsule.svelte";
  import { ICONS } from "../lib/icons";
  import { detectPlatform } from "../lib/platform";

  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const platform = detectPlatform(ua);
  // macOS primary by default (covers "unknown" fallback per spec).
  const macIsPrimary = platform !== "windows";

  function scrollToDownload() {
    document.getElementById("download")?.scrollIntoView({ behavior: "smooth" });
  }
</script>

<section class="px-6 pt-6 pb-24 md:pt-10 md:pb-32">
  <nav class="max-w-6xl mx-auto flex items-center justify-between">
    <a href="/" class="flex items-center gap-3">
      <img src="/soto-mark.svg" alt="" width="32" height="32" />
      <span class="text-base font-semibold tracking-tight">Soto</span>
    </a>
    <div class="flex items-center gap-4">
      <a
        href="https://github.com/cauyxy/sotoapp"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="GitHub"
        class="text-ink-dim hover:text-ink transition-colors"
      >
        <span class="block w-5 h-5">{@html ICONS.github}</span>
      </a>
      <button
        type="button"
        onclick={scrollToDownload}
        class="px-4 py-1.5 rounded-full bg-accent text-bg text-sm font-semibold hover:opacity-90 transition"
      >
        Download
      </button>
    </div>
  </nav>

  <div class="max-w-3xl mx-auto text-center mt-20 md:mt-28">
    <h1 class="text-5xl md:text-7xl font-bold leading-[1.05] tracking-tight">
      Hold to speak.
      <br />
      <span class="bg-gradient-to-r from-accent to-accent-2 bg-clip-text text-transparent">
        Type anywhere.
      </span>
    </h1>
    <p class="mt-6 text-lg md:text-xl text-ink-dim max-w-xl mx-auto">
      AI-powered voice input for your desktop. Hold a hotkey, speak, and your transcript lands
      wherever your cursor is.
      <span class="text-ink-soft">macOS · Windows.</span>
    </p>

    <div class="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
      <button
        type="button"
        onclick={scrollToDownload}
        class={macIsPrimary
          ? "px-6 py-3 rounded-full bg-accent text-bg font-semibold text-base flex items-center gap-2 min-w-[210px] justify-center hover:opacity-90 transition"
          : "px-6 py-3 rounded-full border border-border text-ink font-semibold text-base flex items-center gap-2 min-w-[210px] justify-center hover:border-accent transition"}
      >
        <span class="w-4 h-4">{@html ICONS.apple}</span>
        Download for macOS
      </button>
      <button
        type="button"
        onclick={scrollToDownload}
        class={macIsPrimary
          ? "px-6 py-3 rounded-full border border-border text-ink font-semibold text-base flex items-center gap-2 min-w-[210px] justify-center hover:border-accent transition"
          : "px-6 py-3 rounded-full bg-accent text-bg font-semibold text-base flex items-center gap-2 min-w-[210px] justify-center hover:opacity-90 transition"}
      >
        <span class="w-4 h-4">{@html ICONS.windows}</span>
        Download for Windows
      </button>
    </div>
  </div>

  <div class="mt-16 md:mt-20 flex justify-center">
    <Capsule />
  </div>
</section>
