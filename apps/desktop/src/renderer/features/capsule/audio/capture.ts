// Renderer-side microphone capture — the front half of the voice pipeline
// (plan §1a). getUserMedia → AudioWorklet (ScriptProcessor fallback) → Float32
// frames accumulated here → on stop, encoded to a 16 kHz mono PCM16 WAV via
// @soto/core dsp. The pure math (level metering, frame accumulation, final
// encode) lives in @soto/core / capture-buffer.ts and is unit-tested; the
// MicCapture class below is the thin runtime glue around the Web Audio +
// getUserMedia IO and is exercised only when the app actually runs.
//
// This module is self-contained: it touches NO preload/main/IPC. The Integrate
// stage drives start()/stop()/cancel() and ships the returned base64 WAV to
// main over the typed bridge.

import {
  analyzeVoicedActivity,
  encodeCaptureToWavBase64,
  floatFrameRms,
  rmsAndPeak,
} from "@soto/core";

import { FrameAccumulator, decodeWavPcm } from "./capture-buffer.js";
import type { CaptureFrameMessage } from "./capture-processor.js";
// Vite resolves this to the bundled worklet asset URL at build time. The
// processor is self-contained (no imports), so the plain ?url asset suffices
// for AudioWorklet.addModule(). Kept out of capture-buffer.ts so the pure
// helpers stay importable under vitest (which can't resolve this suffix).
import captureProcessorUrl from "./capture-processor.ts?url";

export { FrameAccumulator, decodeWavPcm };

/** Target sample rate of the produced WAV (matches the provider contract). */
const TARGET_RATE = 16000;

/** Result of a completed capture, ready to forward to the voice session. */
export interface CaptureResult {
  /** Base64-encoded 16 kHz mono PCM16 WAV (header + data). */
  wavBase64: string;
  /** Number of PCM16 samples in the encoded (resampled) WAV. */
  sampleCount: number;
  /** Encoded recording duration in milliseconds (at TARGET_RATE). */
  durationMs: number;
  /** Peak amplitude over the whole recording, [0, 1] — feeds the silence gate. */
  peak: number;
  /** Detected speech duration in the final encoded PCM. */
  voicedMs: number;
  /** RMS amplitude over the whole recording, [0, 1]. */
  rms: number;
}

/** Streamed during capture for the capsule level meter. */
export type LevelCallback = (level: number) => void;

export interface MicCaptureOptions {
  /** Optional input device; omit (or undefined) for the system default. */
  deviceId?: string;
  /**
   * Per-frame meter level (0..1). Called on the main thread for each captured
   * render quantum while recording is active.
   */
  onLevel?: LevelCallback;
}

/** getUserMedia denied/unavailable, surfaced as a typed cause for the caller. */
export class MicPermissionError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "MicPermissionError";
    this.cause = cause;
  }
}

type CaptureState = "idle" | "recording" | "stopped";

/**
 * Microphone capture session. One instance per recording; create, start(),
 * then either stop() (→ CaptureResult) or cancel() (discard + tear down).
 *
 * Runtime-only glue: every method except the FrameAccumulator/dsp math touches
 * the Web Audio graph or getUserMedia and is therefore not unit-tested here.
 */
export class MicCapture {
  private readonly deviceId?: string;
  private readonly onLevel?: LevelCallback;

  private state: CaptureState = "idle";
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private scriptNode: ScriptProcessorNode | null = null;
  private silentSink: GainNode | null = null;

  private readonly accumulator = new FrameAccumulator();
  private sourceRate = TARGET_RATE;
  // In-flight start() promise, so a finish/cancel that races an unresolved
  // start() can await the graph coming up instead of throwing "not recording".
  // Settled (resolve OR reject) — callers swallow its rejection and re-check
  // state. Null until start() is first called.
  private startGate: Promise<void> | null = null;

  constructor(options: MicCaptureOptions = {}) {
    this.deviceId = options.deviceId;
    this.onLevel = options.onLevel;
  }

  /**
   * Acquire the mic and begin capturing. Resolves once the audio graph is live
   * (frames start flowing). Rejects with MicPermissionError if getUserMedia is
   * denied/unavailable; the instance stays safe to cancel().
   */
  start(): Promise<void> {
    if (this.state !== "idle") {
      throw new Error(`MicCapture.start: already ${this.state}`);
    }
    this.startGate = this.startInternal();
    return this.startGate;
  }

  private async startInternal(): Promise<void> {
    const constraints: MediaStreamConstraints = {
      audio: this.deviceId ? { deviceId: { exact: this.deviceId } } : true,
    };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      this.state = "stopped";
      throw new MicPermissionError(
        "Microphone access was denied or is unavailable.",
        err,
      );
    }

    this.context = new AudioContext();
    this.sourceRate = this.context.sampleRate;
    this.source = this.context.createMediaStreamSource(this.stream);

    try {
      await this.startWorklet();
    } catch {
      // Older/edge runtimes without AudioWorklet — degrade to ScriptProcessor.
      this.startScriptProcessor();
    }

    this.state = "recording";
  }

  /**
   * Stop capture and encode the accumulated audio to a 16 kHz mono PCM16 WAV.
   * Tears the graph down. The peak/rms are computed over the final encoded PCM
   * so the caller can drive the silence gate / CapturedRecording directly.
   */
  async stop(): Promise<CaptureResult> {
    // A finish that races an unresolved start(): wait for the graph to come up
    // (or fail), then read the settled state through the awaited gate. Swallow
    // the gate's rejection — the state check below converts a failed start into
    // the clean not-recording path.
    const settledState = this.startGate
      ? await this.startGate.catch(() => undefined).then(() => this.state)
      : this.state;
    if (settledState !== "recording") {
      throw new Error(`MicCapture.stop: not recording (${settledState})`);
    }
    this.state = "stopped";

    const channels = this.accumulator.drain();
    const captured = this.accumulator.sampleCount;

    // Tear the graph down on every exit path via finally, but only after the
    // synchronous empty-capture check — the bail doesn't depend on teardown
    // finishing, so it isn't blocked behind the await.
    try {
      if (channels.length === 0 || captured === 0) {
        // Nothing captured — emit an empty (header-only) WAV; the silence/too-short
        // gates downstream reject it cleanly.
        return {
          wavBase64: encodeCaptureToWavBase64([new Float32Array(0)], this.sourceRate, {
            targetRate: TARGET_RATE,
          }),
          sampleCount: 0,
          durationMs: 0,
          peak: 0,
          voicedMs: 0,
          rms: 0,
        };
      }

      const wavBase64 = encodeCaptureToWavBase64(channels, this.sourceRate, {
        targetRate: TARGET_RATE,
      });
      const { pcm, sampleCount } = decodeWavPcm(wavBase64);
      const { rms, peak } = rmsAndPeak(pcm);
      const { voicedMs } = analyzeVoicedActivity(pcm, { sampleRate: TARGET_RATE });
      const durationMs = Math.round((sampleCount / TARGET_RATE) * 1000);

      return { wavBase64, sampleCount, durationMs, peak, voicedMs, rms };
    } finally {
      await this.teardown();
    }
  }

  /** Discard any captured audio and tear the graph down. Idempotent. */
  async cancel(): Promise<void> {
    if (this.state === "stopped") return;
    // Let an in-flight start() finish acquiring the graph so teardown() can
    // release everything it created (stream tracks / AudioContext). Swallow a
    // start rejection — there's simply nothing to tear down in that case.
    await this.startGate?.catch(() => undefined);
    this.state = "stopped";
    await this.teardown();
  }

  // --- private runtime glue ------------------------------------------------

  private async startWorklet(): Promise<void> {
    const ctx = this.context!;
    await ctx.audioWorklet.addModule(captureProcessorUrl);
    const node = new AudioWorkletNode(ctx, "soto-capture-processor");
    node.port.onmessage = (event: MessageEvent<CaptureFrameMessage>) => {
      this.onFrame(event.data.channels);
    };
    this.source!.connect(node);
    // The worklet has no output; route through a muted gain to the destination
    // so the graph stays pulled by the audio engine without audible monitoring.
    this.silentSink = ctx.createGain();
    this.silentSink.gain.value = 0;
    node.connect(this.silentSink).connect(ctx.destination);
    this.worklet = node;
  }

  private startScriptProcessor(): void {
    const ctx = this.context!;
    // 4096-frame buffer is the widely-supported sweet spot for the deprecated
    // ScriptProcessor fallback. mono in/out; we only read the input.
    const node = ctx.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = (event: AudioProcessingEvent) => {
      const input = event.inputBuffer;
      const channels: Float32Array[] = [];
      for (let c = 0; c < input.numberOfChannels; c++) {
        channels.push(input.getChannelData(c).slice());
      }
      this.onFrame(channels);
    };
    this.source!.connect(node);
    this.silentSink = ctx.createGain();
    this.silentSink.gain.value = 0;
    node.connect(this.silentSink).connect(ctx.destination);
    this.scriptNode = node;
  }

  private onFrame(channels: Float32Array[]): void {
    if (this.state !== "recording") return;
    this.accumulator.push(channels);
    if (this.onLevel) {
      // Meter off the first channel only — cheap and representative; the final
      // downmix happens at encode time.
      this.onLevel(floatFrameRms(channels[0]!));
    }
  }

  private async teardown(): Promise<void> {
    if (this.worklet) {
      this.worklet.port.onmessage = null;
      this.worklet.disconnect();
      this.worklet = null;
    }
    if (this.scriptNode) {
      this.scriptNode.onaudioprocess = null;
      this.scriptNode.disconnect();
      this.scriptNode = null;
    }
    if (this.silentSink) {
      this.silentSink.disconnect();
      this.silentSink = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.context) {
      try {
        await this.context.close();
      } catch {
        // Already closed / unsupported — nothing to do.
      }
      this.context = null;
    }
  }
}
