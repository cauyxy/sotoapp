// Pure-TS port of soto_audio::wav::write_wav_header. Produces the canonical
// 44-byte RIFF/WAVE PCM16 little-endian header followed by interleaved i16 LE
// sample data, byte-identical to what BufferedRecordingFileRecorder finalizes
// on disk. Pure, zero IO.

export interface WavEncodeOptions {
  sampleRate: number;
  channels: number;
}

const BITS_PER_SAMPLE = 16;

/**
 * Encode interleaved PCM16 samples into a canonical 44-byte-header WAV buffer.
 *
 * Header layout (all multi-byte integers little-endian):
 *   0  "RIFF"            | 4  riffSize=36+dataLen | 8  "WAVE"
 *   12 "fmt "            | 16 fmtSize=16          | 20 audioFormat=1 (PCM)
 *   22 numChannels       | 24 sampleRate          | 28 byteRate
 *   32 blockAlign        | 34 bitsPerSample=16    | 36 "data" | 40 dataLen
 *   44 PCM samples (i16 LE, interleaved)
 *
 * dataLen = pcm.length*2, byteRate = sampleRate*channels*2,
 * blockAlign = channels*2, total length = 44 + pcm.length*2.
 */
export function encodeWav(pcm: Int16Array, opts: WavEncodeOptions): Uint8Array {
  const { sampleRate, channels } = opts;
  const blockAlign = channels * (BITS_PER_SAMPLE / 8); // channels * 2
  const byteRate = sampleRate * blockAlign; // sampleRate * channels * 2
  const dataLen = pcm.length * 2; // bytes

  const buffer = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buffer);

  const writeAscii = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataLen, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt "); // trailing space required (4 bytes)
  view.setUint32(16, 16, true); // fixed fmt chunk size
  view.setUint16(20, 1, true); // AudioFormat = PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  writeAscii(36, "data");
  view.setUint32(40, dataLen, true);

  let off = 44;
  for (let i = 0; i < pcm.length; i++, off += 2) {
    view.setInt16(off, pcm[i]!, true); // little-endian i16
  }

  return new Uint8Array(buffer);
}

/**
 * Encode PCM16 samples to a base64 string of the complete WAV payload
 * (44-byte header + PCM data), suitable for transport. Pure, zero IO.
 */
export function pcm16ToWavBase64(pcm: Int16Array, opts: WavEncodeOptions): string {
  return bytesToBase64(encodeWav(pcm, opts));
}

function bytesToBase64(bytes: Uint8Array): string {
  // Browser path: chunk the binary-string conversion to avoid call-stack /
  // argument-count limits on large buffers, then btoa the concatenation.
  if (typeof btoa === "function") {
    const CHUNK = 0x8000; // 32 KiB
    let binary = "";
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }
  // Node fallback.
  return Buffer.from(bytes).toString("base64");
}
