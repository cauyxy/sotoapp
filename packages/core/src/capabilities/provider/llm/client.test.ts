import { describe, expect, it, vi } from "vitest";
import { createLlmPort, validateLlmConfig, type LlmClientConfig } from "./client.js";
import { type FetchLike } from "../omni/client.js";
import { MIMO_API_PROVIDER_ID, MIMO_DEFAULT_MODEL } from "../catalog.js";

function fakeFetch(status: number, body: string): FetchLike {
  return vi.fn(async () => ({ status, text: async () => body }));
}

const okBody = JSON.stringify({ choices: [{ message: { content: "  ok  " } }] });

const mimoConfig: LlmClientConfig = {
  providerId: MIMO_API_PROVIDER_ID,
  apiKey: "secret-key",
  model: MIMO_DEFAULT_MODEL,
  baseUrl: "https://example.com/v1",
  requestProfile: "mimo",
};

const openAiConfig: LlmClientConfig = {
  providerId: "openai-compat",
  apiKey: "secret-key",
  model: "gpt-4o-mini",
  baseUrl: "https://api.example.com/v1",
  requestProfile: "openai_chat",
};

describe("createLlmPort.complete", () => {
  it("POSTs to {base}/chat/completions with bearer auth and text-only content parts", async () => {
    const fetchFn = fakeFetch(200, okBody);
    const port = createLlmPort(mimoConfig, { fetch: fetchFn });

    const text = await port.complete("system instruction", "user transcript");

    expect(text).toBe("ok");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("https://example.com/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer secret-key");
    expect(init.headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init.body);
    expect(body.model).toBe(MIMO_DEFAULT_MODEL);
    expect(body.messages).toEqual([
      { role: "system", content: [{ type: "text", text: "system instruction" }] },
      { role: "user", content: [{ type: "text", text: "user transcript" }] },
    ]);
    // Text-only: never sends audio.
    expect(init.body).not.toContain("input_audio");
  });

  it("omits modalities and thinking for the openai_chat profile", async () => {
    const fetchFn = fakeFetch(200, okBody);
    const port = createLlmPort(openAiConfig, { fetch: fetchFn });

    await port.complete("sys", "usr");

    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse(init.body);
    expect("modalities" in body).toBe(false);
    expect("thinking" in body).toBe(false);
  });

  it("sends modalities ['text'] for the mimo profile", async () => {
    const fetchFn = fakeFetch(200, okBody);
    const port = createLlmPort(mimoConfig, { fetch: fetchFn });

    await port.complete("sys", "usr");

    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse(init.body);
    expect(body.modalities).toEqual(["text"]);
  });

  it("maps a non-2xx status to the right ProviderErrorCode (401 -> authentication_failed)", async () => {
    const port = createLlmPort(mimoConfig, {
      fetch: fakeFetch(401, JSON.stringify({ error: { message: "bad key" } })),
    });

    await expect(port.complete("sys", "usr")).rejects.toMatchObject({
      code: "authentication_failed",
    });
  });

  it("throws empty_response when the 2xx body has no content", async () => {
    const port = createLlmPort(mimoConfig, {
      fetch: fakeFetch(200, JSON.stringify({ choices: [] })),
    });

    await expect(port.complete("sys", "usr")).rejects.toMatchObject({
      code: "empty_response",
    });
  });
});

describe("validateLlmConfig", () => {
  it("sends only a single user message (no system role)", async () => {
    const fetchFn = fakeFetch(200, okBody);

    await expect(validateLlmConfig(mimoConfig, { fetch: fetchFn })).resolves.toBeUndefined();

    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse(init.body);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe("user");
    expect(body.messages.some((m: { role: string }) => m.role === "system")).toBe(false);
  });
});
