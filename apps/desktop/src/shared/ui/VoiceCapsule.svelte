<script lang="ts" module>
  export type VoiceCapsuleState = "idle" | "listening" | "thinking" | "error";
  export const WAVE_BAR_MIN_SCALE = 0.15;
  export type SizeValue = number | string;

  export interface VoiceCapsuleProps {
    barState?: VoiceCapsuleState;
    levels?: number[];
    live?: boolean;
    width?: SizeValue;
    ariaLabel?: string;
    errorLabel?: string;
    class?: string;
  }
</script>

<script lang="ts">
  const STATE_WIDTHS: Record<VoiceCapsuleState, number> = {
    idle: 60,
    listening: 108,
    thinking: 108,
    error: 116
  };

  const DEFAULT_ARIA_LABELS: Record<VoiceCapsuleState, string> = {
    idle: "Voice input idle",
    listening: "Listening",
    thinking: "Polishing",
    error: "Not heard"
  };

  const WAVE_PROFILE = [0.48, 0.74, 1, 0.62, 0.36, 0.86, 0.56, 0.95, 0.66, 0.5, 0.78, 0.4, 0.68, 0.52];

  let {
    barState = "idle" as VoiceCapsuleState,
    levels = [],
    live = true,
    width,
    ariaLabel,
    errorLabel,
    class: className
  }: VoiceCapsuleProps = $props();

  function toCssSize(value: SizeValue | undefined, fallbackPx: number): string {
    if (value === undefined) return `${fallbackPx}px`;
    return typeof value === "number" ? `${value}px` : value;
  }

  const resolvedLabel = $derived(ariaLabel ?? DEFAULT_ARIA_LABELS[barState]);
  const resolvedErrorLabel = $derived(errorLabel ?? DEFAULT_ARIA_LABELS.error);
  const capsuleWidth = $derived(toCssSize(width, STATE_WIDTHS[barState]));
  const LIVE_MIN_SCALE = WAVE_BAR_MIN_SCALE;

  // Returns percentage strings for static/animated bars, or scale numbers
  // (as strings) for live bars so each path can drive the right CSS property.
  const waveBars = $derived.by(() => {
    if (barState !== "listening") return WAVE_PROFILE.map((value) => `${value * 100}%`);
    if (!live) return WAVE_PROFILE.map((value) => `${value * 100}%`);
    if (levels.length === 0) return WAVE_PROFILE.map((value) => `${value * 100}%`);
    // Apply WAVE_PROFILE spatial modulation: bars with higher profile values rise
    // more than neighbours so the wave shape is visible even at uniform input.
    return levels.map((level, i) => {
      const p = WAVE_PROFILE[i % WAVE_PROFILE.length];
      const excess = Math.max(0, level - LIVE_MIN_SCALE);
      const modulated = LIVE_MIN_SCALE + p * excess;
      return String(Math.max(0, Math.min(1, modulated)));
    });
  });
</script>

<div
  class={`voice-capsule${className ? ` ${className}` : ""}`}
  aria-label={resolvedLabel}
  data-state={barState}
  data-testid="voice-capsule"
  style="--voice-capsule-width: {capsuleWidth};"
>
  {#if barState === "idle"}
    <span aria-hidden="true" class="voice-capsule-idle-dot"></span>
  {:else if barState === "listening"}
    <span
      aria-hidden="true"
      class={`voice-capsule-wave${live ? "" : " voice-capsule-wave-static"}`}
      data-live={String(live)}
      data-testid="voice-capsule-wave"
    >
      {#each waveBars as profile, index (index)}
        {@const isLive = live && levels.length > 0}
        <span
          class="voice-capsule-wave-bar"
          data-testid="voice-capsule-wave-bar"
          class:voice-capsule-wave-live={isLive}
          style="{isLive
            ? `--voice-capsule-wave-bar-scale: ${profile}`
            : `--voice-capsule-wave-bar-height: ${profile}`}; --voice-capsule-wave-delay: {(index % 5) * 0.12}s;"
        ></span>
      {/each}
    </span>
  {:else if barState === "thinking"}
    <span aria-hidden="true" class="voice-capsule-thinking-track">
      <span class="voice-capsule-thinking-band" data-testid="voice-capsule-thinking-band"></span>
    </span>
    <span aria-hidden="true" class="voice-capsule-thinking-dots">
      {#each [0, 1, 2] as dotIndex (dotIndex)}
        <span
          class="voice-capsule-thinking-dot"
          data-testid="voice-capsule-thinking-dot"
          style="--voice-capsule-thinking-dot-delay: {dotIndex * 0.18}s;"
        ></span>
      {/each}
    </span>
  {:else if barState === "error"}
    <span class="voice-capsule-error">
      <span aria-hidden="true" class="voice-capsule-error-dot"></span>
      <span class="voice-capsule-error-text">{resolvedErrorLabel}</span>
    </span>
  {/if}
</div>
