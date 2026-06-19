import { describe, expect, it } from "vitest";
import { ASR_VALIDATION_WAV_B64, ASR_VALIDATION_WAV_FORMAT } from "./validationSample.js";
import { base64ToBytes } from "./openaiCompatAsr.js";

describe("ASR validation sample", () => {
  it("declares the wav format", () => {
    expect(ASR_VALIDATION_WAV_FORMAT).toBe("wav");
  });

  it("decodes to the 44-byte header + 9600 PCM bytes (0.3 s @ 16 kHz mono)", () => {
    const bytes = base64ToBytes(ASR_VALIDATION_WAV_B64);
    expect(bytes.length).toBe(44 + 9600);
  });

  it("starts with the ASCII 'RIFF' magic", () => {
    const bytes = base64ToBytes(ASR_VALIDATION_WAV_B64);
    expect(String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!)).toBe("RIFF");
  });
});
