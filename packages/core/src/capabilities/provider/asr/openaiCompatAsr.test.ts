import { describe, expect, it, vi } from "vitest";
import { base64ToBytes, createOpenAiCompatAsr, type AsrClientConfig } from "./openaiCompatAsr.js";
import type { AsrHints } from "./port.js";
import { type FetchLike, type MultipartBody } from "../omni/client.js";
import { pcm16ToWavBase64 } from "../../../foundation/audio/wav.js";

const config: AsrClientConfig = {
  providerId: "openai",
  apiKey: "secret-key",
  model: "whisper-1",
  baseUrl: "https://example.com/v1",
};

const NO_HINTS: AsrHints = { hotwords: [], languageHint: null };

/** Capture the (url, init) of the single fetch call for assertions. */
interface CapturedCall {
  url: string;
  init: {
    method: string;
    headers: Record<string, string>;
    body: string | MultipartBody;
    signal?: AbortSignal;
  };
}

function fakeFetch(
  status: number,
  body: string,
  capture: { call?: CapturedCall },
): FetchLike {
  return vi.fn(async (url, init) => {
    capture.call = { url, init };
    return { status, text: async () => body };
  });
}

/** Node ≥18 FormData supports .get(); type it structurally for the cast. */
function formGet(body: string | MultipartBody, name: string): unknown {
  return (body as unknown as { get(n: string): unknown }).get(name);
}

describe("createOpenAiCompatAsr", () => {
  it("POSTs multipart with bearer auth, correct URL, and no Content-Type header", async () => {
    const capture: { call?: CapturedCall } = {};
    const asr = createOpenAiCompatAsr(config, {
      fetch: fakeFetch(200, JSON.stringify({ text: "hi" }), capture),
    });

    await asr.transcribe({ audioB64: "AAAA", audioFormat: "wav" }, NO_HINTS);

    const call = capture.call!;
    expect(call.url).toBe("https://example.com/v1/audio/transcriptions");
    expect(call.init.method).toBe("POST");
    expect(call.init.headers.Authorization).toBe("Bearer secret-key");
    expect(call.init.headers["Content-Type"]).toBeUndefined();
  });

  it("includes file + model FormData parts", async () => {
    const capture: { call?: CapturedCall } = {};
    const asr = createOpenAiCompatAsr(config, {
      fetch: fakeFetch(200, JSON.stringify({ text: "hi" }), capture),
    });

    await asr.transcribe({ audioB64: "AAAA", audioFormat: "wav" }, NO_HINTS);

    const body = capture.call!.init.body;
    expect(formGet(body, "file")).not.toBeNull();
    expect(formGet(body, "model")).toBe("whisper-1");
  });

  it("includes the language part only when a language hint is set", async () => {
    const withHint: { call?: CapturedCall } = {};
    const asrWith = createOpenAiCompatAsr(config, {
      fetch: fakeFetch(200, JSON.stringify({ text: "" }), withHint),
    });
    await asrWith.transcribe(
      { audioB64: "AAAA", audioFormat: "wav" },
      { hotwords: [], languageHint: "zh" },
    );
    expect(formGet(withHint.call!.init.body, "language")).toBe("zh");

    const without: { call?: CapturedCall } = {};
    const asrWithout = createOpenAiCompatAsr(config, {
      fetch: fakeFetch(200, JSON.stringify({ text: "" }), without),
    });
    await asrWithout.transcribe({ audioB64: "AAAA", audioFormat: "wav" }, NO_HINTS);
    expect(formGet(without.call!.init.body, "language")).toBeNull();
  });

  it("includes the prompt part only when hotwords are non-empty", async () => {
    const withWords: { call?: CapturedCall } = {};
    const asrWith = createOpenAiCompatAsr(config, {
      fetch: fakeFetch(200, JSON.stringify({ text: "" }), withWords),
    });
    await asrWith.transcribe(
      { audioB64: "AAAA", audioFormat: "wav" },
      { hotwords: ["Soto", "Claude"], languageHint: null },
    );
    expect(formGet(withWords.call!.init.body, "prompt")).toBe("Soto、Claude");

    const without: { call?: CapturedCall } = {};
    const asrWithout = createOpenAiCompatAsr(config, {
      fetch: fakeFetch(200, JSON.stringify({ text: "" }), without),
    });
    await asrWithout.transcribe({ audioB64: "AAAA", audioFormat: "wav" }, NO_HINTS);
    expect(formGet(without.call!.init.body, "prompt")).toBeNull();
  });

  it("trims the response text", async () => {
    const asr = createOpenAiCompatAsr(config, {
      fetch: fakeFetch(200, JSON.stringify({ text: " hi " }), {}),
    });
    const result = await asr.transcribe({ audioB64: "AAAA", audioFormat: "wav" }, NO_HINTS);
    expect(result.text).toBe("hi");
  });

  it("treats an empty transcript as a valid result (no throw)", async () => {
    const asr = createOpenAiCompatAsr(config, {
      fetch: fakeFetch(200, JSON.stringify({ text: "" }), {}),
    });
    const result = await asr.transcribe({ audioB64: "AAAA", audioFormat: "wav" }, NO_HINTS);
    expect(result.text).toBe("");
  });

  it("maps 401 to authentication_failed", async () => {
    const asr = createOpenAiCompatAsr(config, {
      fetch: fakeFetch(401, JSON.stringify({ error: { message: "bad key" } }), {}),
    });
    await expect(
      asr.transcribe({ audioB64: "AAAA", audioFormat: "wav" }, NO_HINTS),
    ).rejects.toMatchObject({ code: "authentication_failed" });
  });
});

describe("base64ToBytes", () => {
  it("decodes 'AAAA' to three zero bytes", () => {
    const bytes = base64ToBytes("AAAA");
    expect(bytes.length).toBe(3);
    expect(Array.from(bytes)).toEqual([0, 0, 0]);
  });

  it("round-trips a WAV from pcm16ToWavBase64 starting with ASCII 'RIFF'", () => {
    const b64 = pcm16ToWavBase64(new Int16Array(8), { sampleRate: 16_000, channels: 1 });
    const bytes = base64ToBytes(b64);
    expect(String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!)).toBe("RIFF");
  });
});
