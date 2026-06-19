// Sub-second silent WAV used by the per-capability "save & verify" round trip:
// 0.3 s of 16 kHz mono PCM16 silence. Generated at module load from the
// canonical encoder so it is byte-correct without embedding a binary literal.

import { pcm16ToWavBase64 } from "../../../foundation/audio/wav.js";

export const ASR_VALIDATION_WAV_B64: string = pcm16ToWavBase64(
  new Int16Array(4800), // 0.3 s @ 16 kHz mono
  { sampleRate: 16_000, channels: 1 },
);
export const ASR_VALIDATION_WAV_FORMAT = "wav";
