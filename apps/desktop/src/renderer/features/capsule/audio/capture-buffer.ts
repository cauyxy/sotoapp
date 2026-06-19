// Pure capture buffer helpers — no Web Audio, no worklet URL import, no IO — so
// they are unit-testable in node (vitest) without a DOM. capture.ts (the
// runtime glue) re-exports these alongside the MicCapture class.

/**
 * Accumulates per-channel Float32 frames captured at one fixed channel count,
 * then flattens each channel into a single contiguous Float32Array for encoding.
 *
 * The channel count is locked to the first pushed frame; later frames with a
 * different channel count are rejected (an AudioWorklet never changes its lane
 * count mid-stream, so this only guards against misuse). Per-quantum frames
 * within a channel may differ in length (quanta vs. ScriptProcessor buffers).
 */
export class FrameAccumulator {
  private channels: Float32Array[][] = [];
  private channelCount = 0;
  private total = 0;

  /** Append one render quantum's per-channel frames. */
  push(frame: Float32Array[]): void {
    if (frame.length === 0) return;
    if (this.channelCount === 0) {
      this.channelCount = frame.length;
      this.channels = frame.map(() => []);
    } else if (frame.length !== this.channelCount) {
      throw new Error(
        `FrameAccumulator: channel count changed ${this.channelCount} -> ${frame.length}`,
      );
    }
    for (let c = 0; c < this.channelCount; c++) {
      this.channels[c]!.push(frame[c]!);
    }
    // All channels share a length; track via channel 0.
    this.total += frame[0]!.length;
  }

  /** Number of channels locked in by the first frame (0 if none pushed). */
  get channelLanes(): number {
    return this.channelCount;
  }

  /** Total per-channel sample count accumulated so far. */
  get sampleCount(): number {
    return this.total;
  }

  /**
   * Flatten the accumulated frames into one contiguous Float32Array per channel.
   * Returns an empty array when nothing was captured.
   */
  drain(): Float32Array[] {
    if (this.channelCount === 0) return [];
    const out: Float32Array[] = [];
    for (let c = 0; c < this.channelCount; c++) {
      const merged = new Float32Array(this.total);
      let offset = 0;
      for (const chunk of this.channels[c]!) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      out.push(merged);
    }
    return out;
  }
}

/**
 * Decode a base64 PCM16 WAV (44-byte canonical header from @soto/core wav.ts)
 * back into its Int16Array body. Pure: lets MicCapture.stop() reuse @soto/core's
 * rmsAndPeak for final stats without re-deriving them from the float path.
 */
export function decodeWavPcm(wavBase64: string): {
  pcm: Int16Array;
  sampleCount: number;
} {
  const binary = base64ToBytes(wavBase64);
  const dataView = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  // Body starts at byte 44; dataLen lives at offset 40 (little-endian u32).
  const dataLen = dataView.getUint32(40, true);
  const sampleCount = Math.floor(dataLen / 2);
  const pcm = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    pcm[i] = dataView.getInt16(44 + i * 2, true);
  }
  return { pcm, sampleCount };
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, "base64"));
}
