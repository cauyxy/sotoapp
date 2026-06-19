import { describe, expect, it } from "vitest";
import {
  validateConfig,
  buildResponseRequest,
  buildValidationRequest,
  audioFormatFor,
} from "./request.js";
import {
  MIMO_API_PROVIDER_ID,
  MIMO_API_DEFAULT_BASE_URL,
  MIMO_DEFAULT_MODEL,
  DOUBAO_ARK_PROVIDER_ID,
  DOUBAO_ARK_DEFAULT_BASE_URL,
  DOUBAO_SEED_2_0_LITE_MODEL,
  DASHSCOPE_PROVIDER_ID,
  DASHSCOPE_DEFAULT_BASE_URL,
  QWEN3_5_OMNI_FLASH_MODEL,
} from "../catalog.js";

const mimo: Parameters<typeof buildResponseRequest>[0] = {
  providerId: MIMO_API_PROVIDER_ID,
  apiKey: "test-key",
  model: MIMO_DEFAULT_MODEL,
  baseUrl: MIMO_API_DEFAULT_BASE_URL,
};

describe("validateConfig", () => {
  it("fills the default model and base URL for a known provider when they are blank", () => {
    const normalized = validateConfig({
      providerId: MIMO_API_PROVIDER_ID,
      apiKey: "test-key",
      model: "",
      baseUrl: "",
    });

    expect(normalized).toEqual({
      providerId: MIMO_API_PROVIDER_ID,
      apiKey: "test-key",
      model: MIMO_DEFAULT_MODEL,
      baseUrl: MIMO_API_DEFAULT_BASE_URL,
    });
  });

  it("keeps a custom model for a known provider and trims a trailing slash from the base URL", () => {
    const normalized = validateConfig({
      providerId: MIMO_API_PROVIDER_ID,
      apiKey: "  test-key  ",
      model: " mimo-v2.5-pro ",
      baseUrl: "https://example.com/v1/",
    });

    expect(normalized.model).toBe("mimo-v2.5-pro");
    expect(normalized.apiKey).toBe("test-key");
    expect(normalized.baseUrl).toBe("https://example.com/v1");
  });

  it("accepts recommended and custom Doubao models", () => {
    const normalized = validateConfig({
      providerId: DOUBAO_ARK_PROVIDER_ID,
      apiKey: "k",
      model: "doubao-seed-2-0-pro-260428",
      baseUrl: DOUBAO_ARK_DEFAULT_BASE_URL,
    });
    expect(normalized.model).toBe("doubao-seed-2-0-pro-260428");
  });

  it("rejects a vendor without the omni capability", () => {
    expect(() =>
      validateConfig({ providerId: "openai-compat", apiKey: "k", model: "", baseUrl: "" }),
    ).toThrow(/has no omni capability/);
  });

  it("rejects an unknown provider", () => {
    expect(() =>
      validateConfig({ providerId: "nope", apiKey: "k", model: "", baseUrl: "" }),
    ).toThrow(/Unsupported Omni provider/);
  });

  it("rejects a blank API key", () => {
    expect(() =>
      validateConfig({
        providerId: MIMO_API_PROVIDER_ID,
        apiKey: "   ",
        model: "",
        baseUrl: "",
      }),
    ).toThrow(/API key is required/);
  });

  it("rejects a non-http(s) base URL", () => {
    expect(() =>
      validateConfig({
        providerId: MIMO_API_PROVIDER_ID,
        apiKey: "k",
        model: "",
        baseUrl: "ftp://example.com",
      }),
    ).toThrow(/absolute HTTP or HTTPS URL/);
  });
});

describe("buildResponseRequest", () => {
  it("Mimo: disables thinking, sets modalities=[text], and shapes the system+user+audio messages", () => {
    const body = buildResponseRequest(mimo, "请识别音频中的内容", "User Audio:", "YWJj", "mp3");

    expect(body.model).toBe(MIMO_DEFAULT_MODEL);
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.modalities).toEqual(["text"]);
    expect(body.messages).toEqual([
      { role: "system", content: [{ type: "text", text: "请识别音频中的内容" }] },
      {
        role: "user",
        content: [
          { type: "text", text: "User Audio:" },
          { type: "input_audio", input_audio: { data: "YWJj", format: "mp3" } },
        ],
      },
    ]);
  });

  it("serializes without a modalities key for Doubao (raw base64 audio, thinking disabled)", () => {
    const body = buildResponseRequest(
      { providerId: DOUBAO_ARK_PROVIDER_ID, apiKey: "k", model: DOUBAO_SEED_2_0_LITE_MODEL, baseUrl: DOUBAO_ARK_DEFAULT_BASE_URL },
      "sys",
      "User Audio:",
      "YWJj",
      "mp3",
    );

    const json = JSON.parse(JSON.stringify(body));
    expect(json.thinking).toEqual({ type: "disabled" });
    expect("modalities" in json).toBe(false);
    expect(json.messages[1].content[1].input_audio).toEqual({ data: "YWJj", format: "mp3" });
  });

  it("Dashscope: no thinking, modalities=[text], audio wrapped as a data URI", () => {
    const body = buildResponseRequest(
      { providerId: DASHSCOPE_PROVIDER_ID, apiKey: "k", model: QWEN3_5_OMNI_FLASH_MODEL, baseUrl: DASHSCOPE_DEFAULT_BASE_URL },
      "sys",
      "User Audio:",
      "YWJj",
      "wav",
    );

    const json = JSON.parse(JSON.stringify(body));
    expect("thinking" in json).toBe(false);
    expect(json.modalities).toEqual(["text"]);
    expect(json.messages[1].content[1].input_audio).toEqual({
      data: "data:audio/wav;base64,YWJj",
      format: "wav",
    });
  });

  it("omits thinking control for a Mimo model other than the default", () => {
    const body = buildResponseRequest(
      { providerId: MIMO_API_PROVIDER_ID, apiKey: "k", model: "mimo-v2.5-tts", baseUrl: MIMO_API_DEFAULT_BASE_URL },
      "Say hello.",
      "User Audio:",
      "YWJj",
      "mp3",
    );
    expect("thinking" in JSON.parse(JSON.stringify(body))).toBe(false);
  });
});

describe("buildValidationRequest", () => {
  it("sends a single user message asking for 'ok'", () => {
    const body = buildValidationRequest(mimo);
    expect(body.messages).toEqual([
      { role: "user", content: [{ type: "text", text: 'Reply with the single word "ok".' }] },
    ]);
  });
});

describe("audioFormatFor", () => {
  it("accepts wav and mp3 case-insensitively", () => {
    expect(audioFormatFor("wav")).toBe("wav");
    expect(audioFormatFor("MP3")).toBe("mp3");
  });

  it("rejects any other format", () => {
    expect(() => audioFormatFor("flac")).toThrow(/wav or mp3/);
  });
});
