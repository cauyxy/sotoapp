// Engine factory tests (engine spec §9): fake fetch, pure assertions. The omni
// arm's prompts are compared EXACTLY against the builders imported here,
// pinning request bytes at the builder boundary. Error
// assertions pin ProviderException CODES, not messages (wording is shared and
// provider-neutral).

import { describe, expect, it } from "vitest";
import type { AxContext } from "../../contract/schema.js";
import {
  buildAppContext,
  type TargetContextSnapshot,
} from "../context/context.js";
import { ProviderException } from "../provider/omni/errors.js";
import type { FetchLike } from "../provider/omni/client.js";
import type { WebSocketLike } from "../provider/realtime/socket.js";
import {
  buildPolishPrompt,
  buildVoicePrompt,
} from "../prompts/voicePrompt.js";
import { assembleModelInput } from "../model-input/assembler.js";
import type { TranscriptionRequest } from "./port.js";
import {
  resolveProviderConfig,
  type EngineSpec,
  type ResolvedProviderConfig,
} from "./spec.js";
import {
  createAsrPort,
  createEngineModelRuntime,
  createEngineTranscription,
  resolveCapability,
} from "./engine.js";

const HOTWORDS = ["Soto", "Claude Code"] as const;
const AX: AxContext = {
  full_text: "abcdef",
  selection_start: 1,
  selection_end: 3,
  before: "a",
  after: "def",
  ax_role: null,
  app_bundle_id: "com.x",
  app_name: "X",
  window_title: "Draft",
  web_url: "https://docs.google.com/document/d/abc",
  web_domain: null,
};

const OMNI: ResolvedProviderConfig = {
  providerId: "mimo-api",
  capability: "omni",
  model: "mimo-v2.5",
  baseUrl: "https://api.xiaomimimo.com/v1",
  apiKey: "omni-key",
  requestProfile: "mimo",
};
const ASR: ResolvedProviderConfig = {
  providerId: "openai-compat",
  capability: "asr",
  model: "whisper-1",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "asr-key",
  requestProfile: "openai_transcriptions",
};
const LLM: ResolvedProviderConfig = {
  providerId: "openai-compat",
  capability: "llm",
  model: "gpt-4o-mini",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "llm-key",
  requestProfile: "openai_chat",
};
const ASR_LLM: EngineSpec = { kind: "asr_llm", asr: ASR, llm: LLM, languageHint: "zh" };

function request(over: Partial<TranscriptionRequest> = {}): TranscriptionRequest {
  return {
    modePrompt: "",
    hotwords: HOTWORDS,
    axContext: null,
    audio: { audioB64: "AAAA", audioFormat: "wav" },
    ...over,
  };
}

function target(overrides: Partial<TargetContextSnapshot> = {}): TargetContextSnapshot {
  return {
    id: "target.1",
    capturedAt: 1_700_000_000_000,
    reason: "voice_session_start",
    platform: "macos",
    app: {
      pid: 42,
      bundleId: "com.x",
      localizedName: "X",
      executableName: "X",
    },
    window: { title: "Draft" },
    ax: AX,
    focusedElement: null,
    selection: { text: "bc", source: "ax_selection", confidence: "high" },
    ambientClipboard: null,
    ...overrides,
  };
}

function appContext() {
  return buildAppContext({
    target: target(),
    settings: {
      includeWindowContextInRequests: true,
      clipboardContextInRequests: "off",
    },
  });
}

interface CapturedCall {
  url: string;
  init: { method: string; headers: Record<string, string>; body: unknown };
}

/** Sequential fake fetch: call N gets response N; records every call. */
function fakeFetchSeq(responses: { status: number; body: string }[]): {
  fetch: FetchLike;
  calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const response = responses[calls.length - 1];
    if (response === undefined) throw new Error(`unexpected fetch call #${calls.length}`);
    return { status: response.status, text: async () => response.body };
  };
  return { fetch, calls };
}

const chatBody = (content: string): string =>
  JSON.stringify({ choices: [{ message: { content } }] });

type ChatRequestBody = {
  model: string;
  messages: { role: string; content: { type: string; text?: string; input_audio?: unknown }[] }[];
} & Record<string, unknown>;

function jsonBody(call: CapturedCall): ChatRequestBody {
  return JSON.parse(call.init.body as string) as ChatRequestBody;
}

describe("createEngineTranscription — omni arm", () => {
  it("dictation: keeps the system message stable and sends prompt context in the user text before audio", async () => {
    const { fetch, calls } = fakeFetchSeq([{ status: 200, body: chatBody("  你好，世界  ") }]);
    const port = createEngineTranscription({ kind: "omni", config: OMNI }, { fetch });

    const result = await port.respond(
      request({ modePrompt: "Transcribe this.", axContext: AX }),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.xiaomimimo.com/v1/chat/completions");
    expect(calls[0]!.init.headers.Authorization).toBe("Bearer omni-key");

    const body = jsonBody(calls[0]!);
    const frozen = buildVoicePrompt("Transcribe this.", HOTWORDS, AX);
    expect(body.model).toBe("mimo-v2.5");
    expect(body.messages[0]!.role).toBe("system");
    expect(body.messages[0]!.content).toEqual([{ type: "text", text: "Transcribe this." }]);
    expect(body.messages[0]!.content[0]!.text).toBe(frozen.systemPrompt);
    expect(frozen.systemPrompt).not.toContain("<热词>");
    expect(frozen.systemPrompt).not.toContain("<当前输入框上下文>");
    expect(body.messages[1]!.role).toBe("user");
    expect(body.messages[1]!.content[0]!.text).toBe(frozen.userPrompt);
    expect(body.messages[1]!.content[0]!.text).toContain("<热词>\nSoto、Claude Code\n</热词>");
    expect(body.messages[1]!.content[0]!.text).toContain("<当前输入框上下文>");
    expect(body.messages[1]!.content[1]!.input_audio).toEqual({ data: "AAAA", format: "wav" });

    // raw == final; stamps snapshot the omni config; no llm stamps at all.
    expect(result).toEqual({
      rawText: "你好，世界",
      finalText: "你好，世界",
      providerId: "mimo-api",
      modelId: "mimo-v2.5",
    });
  });

});

describe("ModelRuntime adapter", () => {
  it("resolves model capability from intent and engine spec", () => {
    expect(resolveCapability("dictation", { kind: "omni", config: OMNI })).toBe("omni");
    expect(resolveCapability("dictation", ASR_LLM)).toBe("asr_llm");
  });

  it("runs dictation through the runtime and maps recognition trace", async () => {
    const { fetch, calls } = fakeFetchSeq([{ status: 200, body: chatBody("  你好  ") }]);
    const runtime = createEngineModelRuntime({ kind: "omni", config: OMNI }, { fetch });
    const input = assembleModelInput({
      intent: "dictation",
      modeId: "default",
      modePrompt: "Transcribe this.",
      recording: { audioB64: "AAAA", audioFormat: "wav", durationMs: 1_000, peak: 0.5 },
      appContext: appContext(),
      hotwords: HOTWORDS,
      now: 1_700_000_000_001,
    });

    const result = await runtime.respond(input);

    expect(calls).toHaveLength(1);
    expect(result).toEqual({
      rawText: "你好",
      finalText: "你好",
      providerTrace: {
        recognitionProviderId: "mimo-api",
        recognitionModelId: "mimo-v2.5",
        llmProviderId: null,
        llmModelId: null,
      },
    });
  });

});

describe("createEngineTranscription — asr_llm arm", () => {
  it("plain non-empty dictation runs the LLM hop and stamps both configs", async () => {
    const { fetch, calls } = fakeFetchSeq([
      { status: 200, body: JSON.stringify({ text: " hello world " }) },
      { status: 200, body: chatBody("Hello, world.") },
    ]);
    const port = createEngineTranscription(ASR_LLM, { fetch });

    const result = await port.respond(request());

    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe("https://api.openai.com/v1/audio/transcriptions");
    const form = calls[0]!.init.body as FormData;
    expect(form.get("model")).toBe("whisper-1");
    expect(form.get("language")).toBe("zh"); // EngineSpec.languageHint -> AsrHints
    expect(form.get("prompt")).toBe(HOTWORDS.join("、"));
    expect(calls[1]!.url).toBe("https://api.openai.com/v1/chat/completions");

    expect(result.rawText).toBe("hello world");
    expect(result.finalText).toBe("Hello, world.");
    expect(result.providerId).toBe("openai-compat");
    expect(result.modelId).toBe("whisper-1");
    expect(result.llmProviderId).toBe("openai-compat");
    expect(result.llmModelId).toBe("gpt-4o-mini");
  });

  it("plain dictation runs the LLM hop with the mode prompt as system text and user-side context + stamps", async () => {
    const { fetch, calls } = fakeFetchSeq([
      { status: 200, body: JSON.stringify({ text: "hello world" }) },
      { status: 200, body: chatBody("Hello, world.") },
    ]);
    const port = createEngineTranscription(ASR_LLM, { fetch });

    const result = await port.respond(request({ modePrompt: "Clean this.", axContext: AX }));

    expect(calls).toHaveLength(2);
    expect(calls[1]!.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(calls[1]!.init.headers.Authorization).toBe("Bearer llm-key");

    const body = jsonBody(calls[1]!);
    const polish = buildPolishPrompt("Clean this.", HOTWORDS, AX, "hello world");
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.messages[0]!.content[0]!.text).toBe(polish.systemPrompt);
    expect(body.messages[1]!.content[0]!.text).toBe(polish.userPrompt);
    expect(body.messages[0]!.content[0]!.text).toBe("Clean this.");
    expect(body.messages[0]!.content[0]!.text).not.toContain("<热词>");
    expect(body.messages[0]!.content[0]!.text).not.toContain("<当前输入框上下文>");
    expect(body.messages[1]!.content[0]!.text).toContain("<原始转写>\nhello world\n</原始转写>");
    expect(body.messages[1]!.content[0]!.text).toContain("<热词>\nSoto、Claude Code\n</热词>");
    expect(body.messages[1]!.content[0]!.text).toContain("<当前输入框上下文>");
    // openai_chat profile: no vendor-private fields on the wire.
    expect("modalities" in body).toBe(false);
    expect("thinking" in body).toBe(false);

    expect(result).toEqual({
      rawText: "hello world",
      finalText: "Hello, world.",
      providerId: "openai-compat",
      modelId: "whisper-1",
      llmProviderId: "openai-compat",
      llmModelId: "gpt-4o-mini",
    });
  });

  it("ASR+LLM does not inject a default polish system prompt when the mode prompt is empty", async () => {
    const { fetch, calls } = fakeFetchSeq([
      { status: 200, body: JSON.stringify({ text: "hello world" }) },
      { status: 200, body: chatBody("Hello, world.") },
    ]);
    const port = createEngineTranscription(ASR_LLM, { fetch });

    const result = await port.respond(request({ modePrompt: "", axContext: AX }));

    expect(calls).toHaveLength(2);
    const body = jsonBody(calls[1]!);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]!.role).toBe("user");
    expect(body.messages[0]!.content[0]!.text).not.toContain("语音转写润色助手");
    expect(body.messages[0]!.content[0]!.text).toContain("<原始转写>\nhello world\n</原始转写>");
    expect(body.messages[0]!.content[0]!.text).toContain("<热词>\nSoto、Claude Code\n</热词>");
    expect(body.messages[0]!.content[0]!.text).toContain("<当前输入框上下文>");
    expect(result.finalText).toBe("Hello, world.");
  });

  it("prompted dictation uses the mode prompt in the polish frame", async () => {
    const { fetch, calls } = fakeFetchSeq([
      { status: 200, body: JSON.stringify({ text: "你好" }) },
      { status: 200, body: chatBody("Hello") },
    ]);
    const port = createEngineTranscription(ASR_LLM, { fetch });

    const result = await port.respond(request({ modePrompt: "Translate into English." }));

    expect(calls).toHaveLength(2);
    const body = jsonBody(calls[1]!);
    const polish = buildPolishPrompt("Translate into English.", HOTWORDS, null, "你好");
    expect(body.messages[0]!.content[0]!.text).toBe(polish.systemPrompt);
    expect(body.messages[0]!.content[0]!.text).toBe("Translate into English.");
    expect(body.messages[1]!.content[0]!.text).toContain("<原始转写>\n你好\n</原始转写>");
    expect(body.messages[1]!.content[0]!.text).toContain("<热词>\nSoto、Claude Code\n</热词>");
    expect(result.finalText).toBe("Hello");
    expect(result.llmProviderId).toBe("openai-compat");
    expect(result.llmModelId).toBe("gpt-4o-mini");
  });

  it("LLM hop failure rejects with service_unavailable — no silent raw-text fallback", async () => {
    const { fetch, calls } = fakeFetchSeq([
      { status: 200, body: JSON.stringify({ text: "hello world" }) },
      { status: 500, body: JSON.stringify({ error: { message: "boom" } }) },
    ]);
    const port = createEngineTranscription(ASR_LLM, { fetch });

    let caught: unknown = null;
    try {
      await port.respond(request());
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProviderException);
    expect((caught as ProviderException).code).toBe("service_unavailable");
    expect(calls).toHaveLength(2); // one attempt each, nothing swallowed
  });

  it("empty dictation transcript skips the hop (nothing to polish)", async () => {
    const { fetch, calls } = fakeFetchSeq([
      { status: 200, body: JSON.stringify({ text: "   " }) },
    ]);
    const port = createEngineTranscription(ASR_LLM, { fetch });

    const result = await port.respond(request());

    expect(calls).toHaveLength(1);
    expect(result.rawText).toBe("");
    expect(result.finalText).toBe("");
    expect(result.llmProviderId).toBeUndefined();
  });
});

describe("createAsrPort", () => {
  it("dispatches doubao_flash_asr to the flash adapter (dual-key headers)", async () => {
    const { fetch, calls } = fakeFetchSeq([
      { status: 200, body: JSON.stringify({ result: { text: "好" } }) },
    ]);
    const port = createAsrPort(
      {
        providerId: "doubao-asr",
        capability: "asr",
        model: "bigmodel",
        baseUrl: "https://openspeech.bytedance.com",
        apiKey: "app:secret",
        requestProfile: "doubao_flash_asr",
      },
      { fetch },
    );

    const out = await port.transcribe(
      { audioB64: "AAAA", audioFormat: "wav" },
      { hotwords: [], languageHint: null },
    );

    expect(calls[0]!.url).toBe(
      "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash",
    );
    expect(calls[0]!.init.headers["X-Api-App-Key"]).toBe("app");
    expect(calls[0]!.init.headers["X-Api-Access-Key"]).toBe("secret");
    expect(out.text).toBe("好");
  });

  it("dispatches dashscope_realtime only when a WebSocket transport is injected", () => {
    const { fetch } = fakeFetchSeq([]);
    const socket: WebSocketLike = {
      send: () => {},
      close: () => {},
      on: () => {},
    };
    const port = createAsrPort(
      {
        providerId: "dashscope-realtime",
        capability: "asr",
        model: "qwen3-asr-flash-realtime",
        baseUrl: "wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
        apiKey: "asr-key",
        requestProfile: "dashscope_realtime",
      },
      { fetch, webSocket: () => socket },
    );

    expect(typeof port.transcribe).toBe("function");
  });

  it("throws invalid_configuration for dashscope_realtime without a WebSocket transport", () => {
    const { fetch } = fakeFetchSeq([]);
    expect(() =>
      createAsrPort(
        {
          providerId: "dashscope-realtime",
          capability: "asr",
          model: "qwen3-asr-flash-realtime",
          baseUrl: "wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
          apiKey: "asr-key",
          requestProfile: "dashscope_realtime",
        },
        { fetch },
      ),
    ).toThrow(/WebSocket transport/u);
  });

  it("throws invalid_configuration for a non-ASR request profile", () => {
    const { fetch } = fakeFetchSeq([]);
    let caught: unknown = null;
    try {
      createAsrPort(OMNI, { fetch });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProviderException);
    expect((caught as ProviderException).code).toBe("invalid_configuration");
  });
});

describe("resolveProviderConfig", () => {
  it("fills blank model and base URL from the catalog capability defaults", () => {
    const resolved = resolveProviderConfig(
      { provider_id: "openai-compat", capability: "asr", model: "", base_url: null },
      "key-1",
    );
    expect(resolved).toEqual({
      providerId: "openai-compat",
      capability: "asr",
      model: "whisper-1",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "key-1",
      requestProfile: "openai_transcriptions",
    });
  });

  it("keeps explicit model/base URL (trailing slashes trimmed)", () => {
    const resolved = resolveProviderConfig(
      {
        provider_id: "openai-compat",
        capability: "llm",
        model: "gpt-4o",
        base_url: "https://my.gateway.example/v1///",
      },
      "k",
    );
    expect(resolved.model).toBe("gpt-4o");
    expect(resolved.baseUrl).toBe("https://my.gateway.example/v1");
    expect(resolved.requestProfile).toBe("openai_chat");
  });

  it("throws invalid_configuration when the vendor lacks the capability", () => {
    let caught: unknown = null;
    try {
      resolveProviderConfig(
        { provider_id: "doubao-asr", capability: "llm", model: "", base_url: null },
        "k",
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProviderException);
    expect((caught as ProviderException).code).toBe("invalid_configuration");
  });

  it("throws invalid_configuration for an unknown vendor", () => {
    expect(() =>
      resolveProviderConfig(
        { provider_id: "nope", capability: "omni", model: "", base_url: null },
        "k",
      ),
    ).toThrow(ProviderException);
  });
});
