<script lang="ts">
  import { ICONS, type IconName } from "../lib/icons";

  const FEATURES: { icon: IconName; title: string; copy: string }[] = [
    {
      icon: "waveform",
      title: "Omni-model transcription",
      copy: "One multimodal request carries audio, prompt, and hot-words. Mimo and Doubao Ark backends out of the box."
    },
    {
      icon: "sliders",
      title: "Modes & hot words",
      copy: "Per-mode system prompts — Default, Translate, your own — and a dictionary for domain-specific terms."
    },
    {
      icon: "cursor",
      title: "Universal injection",
      copy: "Inserts into any app via the native input ladder, with clipboard paste as a fallback."
    }
  ];
</script>

<section class="px-6 py-24">
  <div class="max-w-6xl mx-auto grid gap-6 md:grid-cols-3">
    {#each FEATURES as f}
      <div class="rounded-2xl bg-bg-elev border border-border p-6 transition hover:border-accent">
        <span class="block w-8 h-8 text-accent mb-4">{@html ICONS[f.icon]}</span>
        <h3 class="text-lg font-semibold text-ink">{f.title}</h3>
        <p class="mt-3 text-ink-dim leading-relaxed text-sm">{f.copy}</p>
      </div>
    {/each}
  </div>
</section>
