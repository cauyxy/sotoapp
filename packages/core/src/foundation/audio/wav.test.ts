import { describe, expect, it } from "vitest";
import { encodeWav, pcm16ToWavBase64 } from "./wav.js";

const ascii = (bytes: Uint8Array, off: number, len: number): string =>
  String.fromCharCode(...bytes.subarray(off, off + len));

const u16le = (bytes: Uint8Array, off: number): number =>
  bytes[off]! | (bytes[off + 1]! << 8);

const u32le = (bytes: Uint8Array, off: number): number =>
  (bytes[off]! |
    (bytes[off + 1]! << 8) |
    (bytes[off + 2]! << 16) |
    (bytes[off + 3]! << 24)) >>>
  0;

describe("encodeWav", () => {
  it("writes the canonical 44-byte RIFF/WAVE PCM16 header for 16k mono", () => {
    const pcm = new Int16Array([0, 1, -1, 32767, -32768]);
    const wav = encodeWav(pcm, { sampleRate: 16000, channels: 1 });

    const dataLen = pcm.length * 2; // 10

    // RIFF magic + sizes
    expect(ascii(wav, 0, 4)).toBe("RIFF");
    expect(u32le(wav, 4)).toBe(36 + dataLen);
    expect(ascii(wav, 8, 4)).toBe("WAVE");

    // fmt chunk
    expect(ascii(wav, 12, 4)).toBe("fmt "); // trailing space required
    expect(u32le(wav, 16)).toBe(16); // fixed fmt chunk size
    expect(u16le(wav, 20)).toBe(1); // AudioFormat = PCM
    expect(u16le(wav, 22)).toBe(1); // channels
    expect(u32le(wav, 24)).toBe(16000); // sampleRate
    expect(u32le(wav, 28)).toBe(32000); // byteRate = 16000 * 1 * 2
    expect(u16le(wav, 32)).toBe(2); // blockAlign = 1 * 2
    expect(u16le(wav, 34)).toBe(16); // bitsPerSample

    // data chunk
    expect(ascii(wav, 36, 4)).toBe("data");
    expect(u32le(wav, 40)).toBe(dataLen);
  });

  it("computes byteRate and blockAlign for stereo correctly", () => {
    const pcm = new Int16Array([1, 2, 3, 4]);
    const wav = encodeWav(pcm, { sampleRate: 44100, channels: 2 });

    expect(u16le(wav, 22)).toBe(2); // channels
    expect(u32le(wav, 24)).toBe(44100); // sampleRate
    expect(u16le(wav, 32)).toBe(4); // blockAlign = 2 * 2
    expect(u32le(wav, 28)).toBe(44100 * 4); // byteRate = sampleRate * channels * 2
  });

  it("produces total length 44 + pcm.length*2 and data length pcm.length*2", () => {
    const pcm = new Int16Array(100).fill(123);
    const wav = encodeWav(pcm, { sampleRate: 16000, channels: 1 });

    expect(wav.length).toBe(44 + pcm.length * 2);
    expect(u32le(wav, 40)).toBe(pcm.length * 2);
  });

  it("handles empty PCM (header only, dataLen 0)", () => {
    const wav = encodeWav(new Int16Array(0), { sampleRate: 16000, channels: 1 });

    expect(wav.length).toBe(44);
    expect(u32le(wav, 4)).toBe(36);
    expect(u32le(wav, 40)).toBe(0);
  });

  it("writes samples as little-endian i16 at offset 44", () => {
    const pcm = new Int16Array([0x0102, -1, 32767, -32768]);
    const wav = encodeWav(pcm, { sampleRate: 16000, channels: 1 });

    // 0x0102 LE -> 0x02 0x01
    expect(wav[44]).toBe(0x02);
    expect(wav[45]).toBe(0x01);
    // -1 (0xFFFF) -> 0xFF 0xFF
    expect(wav[46]).toBe(0xff);
    expect(wav[47]).toBe(0xff);
    // 32767 (0x7FFF) -> 0xFF 0x7F
    expect(wav[48]).toBe(0xff);
    expect(wav[49]).toBe(0x7f);
    // -32768 (0x8000) -> 0x00 0x80
    expect(wav[50]).toBe(0x00);
    expect(wav[51]).toBe(0x80);
  });

  it("matches the exact canonical 16k mono header bytes", () => {
    const wav = encodeWav(new Int16Array(0), { sampleRate: 16000, channels: 1 });
    const expected = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, // "RIFF"
      0x24, 0x00, 0x00, 0x00, // 36 (riffSize for empty data)
      0x57, 0x41, 0x56, 0x45, // "WAVE"
      0x66, 0x6d, 0x74, 0x20, // "fmt "
      0x10, 0x00, 0x00, 0x00, // 16
      0x01, 0x00, // PCM
      0x01, 0x00, // channels = 1
      0x80, 0x3e, 0x00, 0x00, // sampleRate = 16000
      0x00, 0x7d, 0x00, 0x00, // byteRate = 32000
      0x02, 0x00, // blockAlign = 2
      0x10, 0x00, // bitsPerSample = 16
      0x64, 0x61, 0x74, 0x61, // "data"
      0x00, 0x00, 0x00, 0x00, // dataLen = 0
    ]);
    expect(wav).toEqual(expected);
  });
});

describe("pcm16ToWavBase64", () => {
  it("base64-encodes the full header + data of a tiny known buffer", () => {
    const pcm = new Int16Array([0x0102]);
    const wav = encodeWav(pcm, { sampleRate: 16000, channels: 1 });
    const b64 = pcm16ToWavBase64(pcm, { sampleRate: 16000, channels: 1 });

    // Reference: base64 of the same bytes.
    const expected = Buffer.from(wav).toString("base64");
    expect(b64).toBe(expected);

    // Round-trips back to the identical wav bytes (header + data).
    const decoded = new Uint8Array(Buffer.from(b64, "base64"));
    expect(decoded).toEqual(wav);
  });

  it("base64-encodes large buffers (chunked path) identically", () => {
    const pcm = new Int16Array(50_000);
    for (let i = 0; i < pcm.length; i++) pcm[i] = (i % 65536) - 32768;
    const wav = encodeWav(pcm, { sampleRate: 16000, channels: 1 });
    const b64 = pcm16ToWavBase64(pcm, { sampleRate: 16000, channels: 1 });
    expect(b64).toBe(Buffer.from(wav).toString("base64"));
  });
});
