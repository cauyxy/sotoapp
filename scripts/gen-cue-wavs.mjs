// Generates Soto's original recording cue earcons (no third-party audio).
//   start.wav — a soft RISING two-note chime  ("listening")
//   stop.wav  — a soft FALLING two-note chime  ("done")
// 16-bit PCM mono WAV. Each note uses a smooth raised-cosine attack and an
// exponential (bell-like) decay to near-silence, so there is no click and no
// harsh sustained "beep" — warm and gentle, in a mid register (G4 / C5) rather
// than a piercing high one. Run: node scripts/gen-cue-wavs.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SAMPLE_RATE = 44100;

/** Build a PCM16 mono WAV Buffer from a Float32 sample array in [-1,1]. */
function wav(samples) {
  const dataLen = samples.length * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write("data", 36);
  buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buf;
}

/**
 * One soft bell-ish note: a smooth attack (no click) then an exponential decay
 * to near-silence (no hard cut, no sustained beep → not "sharp").
 */
function tone(freq, ms, gain) {
  const n = Math.round((ms / 1000) * SAMPLE_RATE);
  const attack = Math.round(0.007 * SAMPLE_RATE); // 7ms raised-cosine attack
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    let env;
    if (i < attack) {
      env = 0.5 - 0.5 * Math.cos((Math.PI * i) / attack); // 0 → 1, smooth
    } else {
      // exp decay to ~0.013 of peak by the end → effectively silent, clickless.
      env = Math.exp((-4.3 * (i - attack)) / (n - attack));
    }
    out[i] = Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE) * gain * env;
  }
  return out;
}

function concat(...segments) {
  const total = segments.reduce((a, s) => a + s.length, 0);
  const out = new Float32Array(total);
  let off = 0;
  for (const s of segments) {
    out.set(s, off);
    off += s.length;
  }
  return out;
}

// Mid-register, warm. Perfect fourth: rising for start, falling for stop.
const LOW = 392.0; // G4
const HIGH = 523.25; // C5
const GAIN = 0.2;

const start = concat(tone(LOW, 230, GAIN), tone(HIGH, 250, GAIN));
const stop = concat(tone(HIGH, 230, GAIN), tone(LOW, 270, GAIN * 0.95));

const outDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "apps",
  "desktop",
  "src",
  "renderer",
  "features",
  "capsule",
  "cues",
);
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "start.wav"), wav(start));
writeFileSync(join(outDir, "stop.wav"), wav(stop));
console.log("wrote start.wav + stop.wav to", outDir);
