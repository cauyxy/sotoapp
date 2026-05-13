<script lang="ts">
  import { onDestroy } from "svelte";

  import VoiceCapsuleOverlay from "../shared/ui/VoiceCapsuleOverlay.svelte";
  import { listenWithCleanup } from "../shared/listenWithCleanup";
  import {
    VOICE_BAR_TERMINAL_ERROR_RESET_MS,
    VOICE_RUNTIME_EVENT,
    type VoiceBarState,
    type VoiceRuntimeErrorCode,
    type VoiceRuntimeEvent
  } from "../shared/voice";
  import { cancelActiveVoiceRuntime, type EmptyReason } from "./sessions.ipc";
  import { t } from "../i18n";
  import { toast } from "../shared/ui/toast";

  let barState = $state<VoiceBarState>("idle");
  let visible = $state(false);
  let errorCode = $state<VoiceRuntimeErrorCode>("generic");
  let emptyReason = $state<EmptyReason | undefined>(undefined);
  const LEVEL_BAR_COUNT = 14;
  // Floor for level data pushed into liveLevels. Matches WAVE_BAR_MIN_SCALE in
  // VoiceCapsule so silence renders at the same height as the resting animation.
  const LEVEL_MIN_SCALE = 0.15;
  // Adaptive gain: peak decays at ~13 s half-life; floor prevents amplifying silence.
  const ADAPTIVE_DECAY = 0.995;
  const ADAPTIVE_FLOOR = 0.5;
  let liveLevels = $state(Array.from({ length: LEVEL_BAR_COUNT }, () => LEVEL_MIN_SCALE));
  let adaptivePeak = ADAPTIVE_FLOOR;
  let errorResetTimer: number | undefined;

  function clearErrorReset() {
    if (errorResetTimer === undefined) return;
    window.clearTimeout(errorResetTimer);
    errorResetTimer = undefined;
  }

  function resetLiveLevels() {
    liveLevels = Array.from({ length: LEVEL_BAR_COUNT }, () => LEVEL_MIN_SCALE);
    adaptivePeak = ADAPTIVE_FLOOR;
  }

  function clampLevel(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value)) return 0;
    return Math.min(1000, Math.max(0, value));
  }

  // Maps a backend metric (u16, 0–1000 = RMS²×1000) to a scaleY factor in
  // [LEVEL_MIN_SCALE, 1.0] using a dBFS log curve so that quiet speech
  // (-40 dBFS, RMS≈0.01) already reaches ~0.5 scale and loud speech fills
  // the wave container. The output is fed directly into CSS scaleY, so the
  // visible bar height is always proportional to the wave container height.
  function metricToScale(metric: number): number {
    if (metric <= 0) return LEVEL_MIN_SCALE;
    const db = 20 * Math.log10(Math.max(metric / 1000, 1e-4)); // dBFS, floor -60
    const normalized = Math.max(0, Math.min(1, (db + 60) / 60));
    return LEVEL_MIN_SCALE + normalized * (1 - LEVEL_MIN_SCALE);
  }

  function pushLiveLevel(rms: unknown, peak: unknown) {
    const current = metricToScale(Math.max(clampLevel(rms), clampLevel(peak)));
    // Track running peak with slow decay; normalize current level against it so
    // the visualization reflects relative loudness, not absolute dBFS.
    adaptivePeak = Math.max(adaptivePeak * ADAPTIVE_DECAY, current, ADAPTIVE_FLOOR);
    const range = adaptivePeak - LEVEL_MIN_SCALE;
    const normalized =
      range > 0.01
        ? LEVEL_MIN_SCALE + ((current - LEVEL_MIN_SCALE) / range) * (1 - LEVEL_MIN_SCALE)
        : current;
    liveLevels = [...liveLevels.slice(1), Math.min(1, Math.max(LEVEL_MIN_SCALE, normalized))];
  }

  const waveLevels = $derived(barState === "listening" ? liveLevels : undefined);

  function presentTerminalError(code: VoiceRuntimeErrorCode = "generic") {
    clearErrorReset();
    emptyReason = undefined;
    errorCode = code;
    barState = "error";
    visible = true;
    errorResetTimer = window.setTimeout(() => {
      errorResetTimer = undefined;
      visible = false;
      barState = "idle";
    }, VOICE_BAR_TERMINAL_ERROR_RESET_MS);
  }

  function presentEmptyReasonHint(reason: EmptyReason) {
    clearErrorReset();
    emptyReason = reason;
    errorCode = "generic";
    barState = "error";
    visible = true;
    errorResetTimer = window.setTimeout(() => {
      errorResetTimer = undefined;
      visible = false;
      barState = "idle";
      emptyReason = undefined;
    }, VOICE_BAR_TERMINAL_ERROR_RESET_MS);
  }

  // Listener registration is async; we have to bridge the gap between the
  // `listen()` promise resolving and the component being destroyed.
  $effect(() =>
    listenWithCleanup<VoiceRuntimeEvent>(
      VOICE_RUNTIME_EVENT,
      (event) => {
      console.debug("[soto-fe] capsule voice-runtime event:", event.payload);
      clearErrorReset();
      if (event.payload.kind === "started") {
        emptyReason = undefined;
        barState = "listening";
        visible = true;
        resetLiveLevels();
        return;
      }
      if (event.payload.kind === "level") {
        pushLiveLevel(event.payload.rms, event.payload.peak);
        if (barState === "idle") {
          barState = "listening";
          visible = true;
        }
        return;
      }
      if (event.payload.kind === "thinking") {
        emptyReason = undefined;
        barState = "thinking";
        visible = true;
        return;
      }
      if (event.payload.kind === "completed" || event.payload.kind === "cancelled") {
        emptyReason = undefined;
        visible = false;
        return;
      }
      if (event.payload.kind === "failed") {
        const reason = event.payload.empty_reason;
        if (reason) {
          presentEmptyReasonHint(reason);
          return;
        }
        emptyReason = undefined;
        visible = false;
        return;
      }
      console.warn("[soto-fe] capsule entered error state:", event.payload);
      const code: VoiceRuntimeErrorCode =
        event.payload.code === "missing_provider" ? "missing_provider" : "generic";
      presentTerminalError(code);
      },
      {
        onError: (error) => {
          console.warn("[soto-fe] capsule voice-runtime listen failed:", error);
          presentTerminalError();
        }
      }
    )
  );

  function handleKey(event: KeyboardEvent) {
    if (event.key === "Escape") {
      void cancelActiveVoiceRuntime().catch((error) => {
        console.warn("[soto-fe] cancel_active_voice_runtime failed:", error);
        toast($t("capsule.cancelFailed"));
      });
    }
  }

  $effect(() => {
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  onDestroy(clearErrorReset);

  const ariaLabel = $derived($t(`capsule.aria.${barState}` as "capsule.aria.idle"));
  const errorLabel = $derived.by(() => {
    if (emptyReason === "too_short") return $t("capsule.error.tooShort");
    if (emptyReason === "silent") return $t("capsule.error.silent");
    if (emptyReason === "no_recognition") return $t("capsule.error.noRecognition");
    if (errorCode === "missing_provider") return $t("capsule.error.missingProvider");
    return $t("capsule.error.generic");
  });
</script>

<VoiceCapsuleOverlay
  bottom={1}
  {barState}
  {visible}
  levels={waveLevels}
  live
  {ariaLabel}
  {errorLabel}
/>
