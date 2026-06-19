/// <reference lib="webworker" />

// AudioWorklet processor (runtime-only — runs on the audio render thread, never
// in vitest). It is deliberately dumb: it copies each input render quantum's
// per-channel Float32 samples and posts them to the main thread, where
// capture.ts does all the math (level metering + final encode) via @soto/core.
//
// Why copy: the Float32Array `inputs[ch]` is a view onto a buffer the audio
// engine reuses every quantum, so it MUST be copied (slice) before transfer or
// the consumer would observe overwritten samples. We transfer the copies'
// buffers to avoid an extra structured-clone allocation.
//
// AudioWorkletProcessor / registerProcessor are AudioWorkletGlobalScope globals
// not present in lib.dom; declare the minimum we touch so this typechecks under
// tsconfig.web without pulling in extra libs.

declare const sampleRate: number;
declare function registerProcessor(
  name: string,
  ctor: new () => AudioWorkletProcessorLike,
): void;

interface AudioWorkletProcessorLike {
  readonly port: MessagePort;
  process(inputs: Float32Array[][]): boolean;
}

declare const AudioWorkletProcessor: {
  prototype: AudioWorkletProcessorLike;
  new (): AudioWorkletProcessorLike;
};

/** Message posted from the worklet to capture.ts, once per render quantum. */
export interface CaptureFrameMessage {
  /** Per-channel Float32 sample copies for this quantum. */
  channels: Float32Array[];
  /** The AudioContext sample rate (constant for the session). */
  sampleRate: number;
}

class SotoCaptureProcessor extends AudioWorkletProcessor {
  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    // No connected input this quantum (e.g. mid-teardown) — keep alive.
    if (!input || input.length === 0) return true;

    const channels: Float32Array[] = [];
    const transfer: ArrayBuffer[] = [];
    for (const channel of input) {
      // Empty channel guard: a disconnected source can yield a 0-length frame.
      if (channel.length === 0) continue;
      const copy = channel.slice();
      channels.push(copy);
      transfer.push(copy.buffer);
    }
    if (channels.length === 0) return true;

    const message: CaptureFrameMessage = { channels, sampleRate };
    this.port.postMessage(message, transfer);
    return true;
  }
}

registerProcessor("soto-capture-processor", SotoCaptureProcessor);
