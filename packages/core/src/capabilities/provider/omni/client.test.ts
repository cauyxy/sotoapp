import { describe, expect, it, vi } from "vitest";
import { OmniClient, type FetchLike } from "./client.js";
import { MIMO_API_PROVIDER_ID, MIMO_DEFAULT_MODEL } from "../catalog.js";

const config = {
  providerId: MIMO_API_PROVIDER_ID,
  apiKey: "secret-key",
  model: MIMO_DEFAULT_MODEL,
  baseUrl: "https://example.com/v1",
};

function fakeFetch(status: number, body: string): FetchLike {
  return vi.fn(async () => ({ status, text: async () => body }));
}

const okBody = JSON.stringify({ choices: [{ message: { content: "  hi there  " } }] });

describe("OmniClient.respond", () => {
  it("POSTs the chat-completions request with bearer auth and returns the parsed content", async () => {
    const fetchFn = fakeFetch(200, okBody);
    const client = new OmniClient({ fetch: fetchFn });

    const text = await client.respond({
      config,
      systemPrompt: "sys",
      userPrompt: "User Audio:",
      audioB64: "YWJj",
      audioFormat: "wav",
    });

    expect(text).toBe("hi there");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("https://example.com/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer secret-key");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body).model).toBe(MIMO_DEFAULT_MODEL);
  });

  it("maps a non-2xx status to a ProviderException via the error envelope", async () => {
    const client = new OmniClient({
      fetch: fakeFetch(401, JSON.stringify({ error: { message: "bad key" } })),
    });

    await expect(
      client.respond({ config, systemPrompt: "s", userPrompt: "u", audioB64: "YWJj", audioFormat: "wav" }),
    ).rejects.toMatchObject({ code: "authentication_failed" });
  });

  it("throws empty_response when a 2xx body has no content", async () => {
    const client = new OmniClient({ fetch: fakeFetch(200, JSON.stringify({ choices: [] })) });

    await expect(
      client.respond({ config, systemPrompt: "s", userPrompt: "u", audioB64: "YWJj", audioFormat: "wav" }),
    ).rejects.toMatchObject({ code: "empty_response" });
  });

  it("rejects an invalid config before making any network call", async () => {
    const fetchFn = fakeFetch(200, okBody);
    const client = new OmniClient({ fetch: fetchFn });

    await expect(
      client.respond({
        config: { ...config, providerId: "nope" },
        systemPrompt: "s",
        userPrompt: "u",
        audioB64: "YWJj",
        audioFormat: "wav",
      }),
    ).rejects.toMatchObject({ code: "invalid_configuration" });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("OmniClient.validate", () => {
  it("resolves on a 2xx response", async () => {
    const client = new OmniClient({ fetch: fakeFetch(200, "ok") });
    await expect(client.validate(config)).resolves.toBeUndefined();
  });

  it("throws on a non-2xx response", async () => {
    const client = new OmniClient({ fetch: fakeFetch(429, "slow down") });
    await expect(client.validate(config)).rejects.toMatchObject({ code: "rate_limited" });
  });
});
