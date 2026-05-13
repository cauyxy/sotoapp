<script lang="ts">
  import VoiceCapsule, { type VoiceCapsuleProps, type VoiceCapsuleState, type SizeValue } from "./VoiceCapsule.svelte";

  interface Props extends VoiceCapsuleProps {
    visible?: boolean;
    bottom?: SizeValue;
  }

  let {
    barState = "idle" as VoiceCapsuleState,
    visible = true,
    bottom = 1,
    levels,
    live,
    width,
    ariaLabel,
    errorLabel,
    class: className
  }: Props = $props();

  function toCssSize(value: SizeValue | undefined, fallbackPx: number): string {
    if (value === undefined) return `${fallbackPx}px`;
    return typeof value === "number" ? `${value}px` : value;
  }

  let displayState = $state<VoiceCapsuleState>("idle");
  let wasVisible = false;

  $effect(() => {
    if (!visible) {
      wasVisible = false;
      if (barState === "idle") displayState = "idle";
      return;
    }
    const shouldStageEnter = !wasVisible && barState !== "idle";
    wasVisible = true;
    if (!shouldStageEnter) {
      displayState = barState;
      return;
    }
    displayState = "idle";
    const timer = window.setTimeout(() => {
      displayState = barState;
    }, 100);
    return () => window.clearTimeout(timer);
  });

  const overlayBottom = $derived(toCssSize(bottom, 1));
</script>

<div
  aria-hidden={!visible}
  class={visible ? "voice-capsule-overlay voice-capsule-overlay-visible" : "voice-capsule-overlay voice-capsule-overlay-hidden"}
  data-testid="voice-capsule-overlay"
  data-visible={String(visible)}
  style="--voice-capsule-overlay-bottom: {overlayBottom};"
>
  <div class="voice-capsule-overlay-inner">
    <VoiceCapsule
      barState={displayState}
      {live}
      {levels}
      {width}
      {ariaLabel}
      {errorLabel}
      class={className}
    />
  </div>
</div>
