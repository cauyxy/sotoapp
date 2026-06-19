import { describe, expect, it, vi } from "vitest";
import {
  createDoubaoAsr,
  DOUBAO_FLASH_ASR_PATH,
  DOUBAO_FLASH_RESOURCE_ID,
  splitDoubaoKeys,
} from "./doubaoAsr.js";
import type { AsrClientConfig } from "./openaiCompatAsr.js";
import type { AsrHints } from "./port.js";
import { type FetchLike } from "../omni/client.js";

const config: AsrClientConfig = {
  providerId: "doubao",
  apiKey: "app:secret-key",
  model: "bigmodel",
  baseUrl: "https://openspeech.bytedance.com",
};

const NO_HINTS: AsrHints = { hotwords: [], languageHint: null };

interface CapturedCall {
  url: string;
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  };
}

function fakeFetch(
  status: number,
  body: string,
  capture: { call?: CapturedCall },
): FetchLike {
  return vi.fn(async (url, init) => {
    capture.call = { url, init: init as CapturedCall["init"] };
    return { status, text: async () => body };
  });
}

describe("splitDoubaoKeys", () => {
  it("splits on the first colon, keeping later colons in the access key", () => {
    expect(splitDoubaoKeys("app:secret:with:colons")).toEqual({
      appKey: "app",
      accessKey: "secret:with:colons",
    });
  });

  it("throws invalid_configuration when there is no colon", () => {
    expect(() => splitDoubaoKeys("nocolon")).toThrow();
    try {
      splitDoubaoKeys("nocolon");
    } catch (err) {
      expect(err).toMatchObject({ code: "invalid_configuration" });
    }
  });

  it("throws invalid_configuration when the colon is leading or trailing", () => {
    try {
      splitDoubaoKeys(":onlyaccess");
    } catch (err) {
      expect(err).toMatchObject({ code: "invalid_configuration" });
    }
    try {
      splitDoubaoKeys("onlyapp:");
    } catch (err) {
      expect(err).toMatchObject({ code: "invalid_configuration" });
    }
  });
});

describe("createDoubaoAsr", () => {
  it("sets the X-Api-* headers with split keys and a stable request id", async () => {
    const capture: { call?: CapturedCall } = {};
    const asr = createDoubaoAsr(
      { ...config, apiKey: "app:secret:with:colons" },
      {
        fetch: fakeFetch(200, JSON.stringify({ result: { text: "ok" } }), capture),
        requestId: () => "req-123",
      },
    );

    await asr.transcribe({ audioB64: "AAAA", audioFormat: "wav" }, NO_HINTS);

    const { url, init } = capture.call!;
    expect(url).toBe(`https://openspeech.bytedance.com${DOUBAO_FLASH_ASR_PATH}`);
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers["X-Api-App-Key"]).toBe("app");
    expect(init.headers["X-Api-Access-Key"]).toBe("secret:with:colons");
    expect(init.headers["X-Api-Resource-Id"]).toBe(DOUBAO_FLASH_RESOURCE_ID);
    expect(init.headers["X-Api-Request-Id"]).toBe("req-123");
    expect(init.headers["X-Api-Sequence"]).toBe("-1");
  });

  it("builds the body with audio data/format, model_name, and flags", async () => {
    const capture: { call?: CapturedCall } = {};
    const asr = createDoubaoAsr(config, {
      fetch: fakeFetch(200, JSON.stringify({ result: { text: "ok" } }), capture),
    });

    await asr.transcribe({ audioB64: "BBBB", audioFormat: "wav" }, NO_HINTS);

    const body = JSON.parse(capture.call!.init.body);
    expect(body.audio.data).toBe("BBBB");
    expect(body.audio.format).toBe("wav");
    expect(body.request.model_name).toBe("bigmodel");
    expect(body.request.enable_itn).toBe(true);
    expect(body.request.enable_punc).toBe(true);
    expect(body.request.corpus).toBeUndefined();
  });

  it("embeds the hotword corpus.context JSON only when hotwords are present", async () => {
    const capture: { call?: CapturedCall } = {};
    const asr = createDoubaoAsr(config, {
      fetch: fakeFetch(200, JSON.stringify({ result: { text: "ok" } }), capture),
    });

    await asr.transcribe(
      { audioB64: "AAAA", audioFormat: "wav" },
      { hotwords: ["Soto", "Claude"], languageHint: null },
    );

    const body = JSON.parse(capture.call!.init.body);
    expect(JSON.parse(body.request.corpus.context)).toEqual({
      hotwords: [{ word: "Soto" }, { word: "Claude" }],
    });
  });

  it("rejects a bad key format with invalid_configuration before fetching", async () => {
    const fetchFn = vi.fn();
    const asr = createDoubaoAsr(
      { ...config, apiKey: "nocolon" },
      { fetch: fetchFn as unknown as FetchLike },
    );
    await expect(
      asr.transcribe({ audioB64: "AAAA", audioFormat: "wav" }, NO_HINTS),
    ).rejects.toMatchObject({ code: "invalid_configuration" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("maps 403 to authentication_failed", async () => {
    const asr = createDoubaoAsr(config, {
      fetch: fakeFetch(403, JSON.stringify({ error: { message: "denied" } }), {}),
    });
    await expect(
      asr.transcribe({ audioB64: "AAAA", audioFormat: "wav" }, NO_HINTS),
    ).rejects.toMatchObject({ code: "authentication_failed" });
  });

  it("parses result.text and trims it", async () => {
    const asr = createDoubaoAsr(config, {
      fetch: fakeFetch(200, JSON.stringify({ result: { text: " hello " } }), {}),
    });
    const result = await asr.transcribe({ audioB64: "AAAA", audioFormat: "wav" }, NO_HINTS);
    expect(result.text).toBe("hello");
  });

  it("treats a missing/empty result text as a valid empty result", async () => {
    const asr = createDoubaoAsr(config, {
      fetch: fakeFetch(200, JSON.stringify({ result: { text: "" } }), {}),
    });
    const result = await asr.transcribe({ audioB64: "AAAA", audioFormat: "wav" }, NO_HINTS);
    expect(result.text).toBe("");
  });
});
