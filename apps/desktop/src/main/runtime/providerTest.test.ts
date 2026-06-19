import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import type { FetchLike, ProviderConfig, WebSocketFactory, WebSocketLike } from "@soto/core";
import { applyMigrations } from "../db/migrate.js";
import { SqliteStore, identityCrypto, freshValidation } from "../db/store.js";
import { validateProviderConfig } from "./providerTest.js";

// In-memory SqliteStore seeded with one provider config + secret, exercised
// against a fake fetch so the real validation round-trips (per capability) run
// with no network. Mirrors the main-process path: config + decrypted api_key
// -> resolveProviderConfig -> capability-specific client.
function makeStore(over: Partial<ProviderConfig> = {}): SqliteStore {
  const db = new Database(":memory:");
  applyMigrations(db);
  const store = new SqliteStore(db, identityCrypto);
  store.upsertProviderConfig({
    provider_id: "mimo-api",
    display_name: null,
    model: "mimo-v2.5",
    base_url: null,
    is_default: true,
    capability: "omni",
    validation: freshValidation(),
    created_at: BigInt(Date.now()),
    updated_at: BigInt(Date.now()),
    ...over,
    config_id: "config.seed", // pinned: the secret below joins on this id
  });
  store.putProviderSecrets({
    config_id: "config.seed",
    api_key: "super-secret",
    endpoint: null,
  });
  return store;
}

// 200 with a usable chat-completions body -> validate() resolves.
const okFetch: FetchLike = async () => ({
  status: 200,
  text: async () => JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
});

// 401 with an OpenAI-style error envelope -> ProviderException(authentication_failed).
const unauthorizedFetch: FetchLike = async () => ({
  status: 401,
  text: async () => JSON.stringify({ error: { message: "Invalid API key" } }),
});

class ValidationSocket implements WebSocketLike {
  readonly sent: unknown[] = [];
  private readonly messageHandlers: Array<(data: string) => void> = [];
  private readonly errorHandlers: Array<(err: Error) => void> = [];
  private readonly closeHandlers: Array<(code: number, reason: string) => void> = [];

  send(data: string): void {
    const event = JSON.parse(data) as { type?: string };
    this.sent.push(event);
    if (event.type === "session.update") {
      queueMicrotask(() => this.message({ type: "session.updated" }));
    }
    if (event.type === "input_audio_buffer.commit") {
      queueMicrotask(() =>
        this.message({ type: "conversation.item.input_audio_transcription.completed", transcript: "" }),
      );
    }
  }

  close(): void {}

  on(event: "open", cb: () => void): void;
  on(event: "message", cb: (data: string) => void): void;
  on(event: "error", cb: (err: Error) => void): void;
  on(event: "close", cb: (code: number, reason: string) => void): void;
  on(
    event: "open" | "message" | "error" | "close",
    cb: (() => void) | ((data: string) => void) | ((err: Error) => void) | ((code: number, reason: string) => void),
  ): void {
    if (event === "message") this.messageHandlers.push(cb as (data: string) => void);
    if (event === "error") this.errorHandlers.push(cb as (err: Error) => void);
    if (event === "close") this.closeHandlers.push(cb as (code: number, reason: string) => void);
  }

  start(): void {
    queueMicrotask(() => this.message({ type: "session.created" }));
  }

  private message(event: unknown): void {
    for (const cb of this.messageHandlers) cb(JSON.stringify(event));
  }
}

function validationWebSocket(capture: { url?: string; socket?: ValidationSocket }): WebSocketFactory {
  return (url) => {
    capture.url = url;
    const socket = new ValidationSocket();
    capture.socket = socket;
    socket.start();
    return socket;
  };
}

describe("validateProviderConfig", () => {
  it("returns ok with a measured latency on a 200 round-trip", async () => {
    const store = makeStore();
    const result = await validateProviderConfig(store, okFetch, "config.seed");
    expect(result.config_id).toBe("config.seed");
    expect(result.status).toBe("ok");
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
    expect(typeof result.latency_ms).toBe("number");
  });

  it("returns err with the provider message as note on a 401", async () => {
    const store = makeStore();
    const result = await validateProviderConfig(store, unauthorizedFetch, "config.seed");
    expect(result.status).toBe("err");
    expect(result.note).toContain("Invalid API key");
    expect(result.note).toContain("401");
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("returns err when the config is missing", async () => {
    const store = makeStore();
    const result = await validateProviderConfig(store, okFetch, "config.nope");
    expect(result.config_id).toBe("config.nope");
    expect(result.status).toBe("err");
    expect(result.note.length).toBeGreaterThan(0);
  });

  it("returns err when the secret is missing", async () => {
    const store = makeStore();
    store.deleteProviderSecrets("config.seed");
    const result = await validateProviderConfig(store, okFetch, "config.seed");
    expect(result.status).toBe("err");
    expect(result.note.length).toBeGreaterThan(0);
  });
});

describe("validateProviderConfig per capability (engine spec §8)", () => {
  it("asr: the silent WAV through the real transcribe path passes on a 2xx with an empty transcript", async () => {
    const store = makeStore({ provider_id: "openai-compat", capability: "asr", model: "whisper-1" });
    const urls: string[] = [];
    const fetchFn: FetchLike = async (url) => {
      urls.push(url);
      return { status: 200, text: async () => JSON.stringify({ text: "" }) };
    };
    const result = await validateProviderConfig(store, fetchFn, "config.seed");
    expect(result.status).toBe("ok");
    expect(urls).toEqual(["https://api.openai.com/v1/audio/transcriptions"]);
  });

  it("asr: dashscope-realtime validates through the WebSocket ASR branch", async () => {
    const store = makeStore({
      provider_id: "dashscope-realtime",
      capability: "asr",
      model: "qwen3-asr-flash-realtime",
    });
    let fetched = 0;
    const fetchFn: FetchLike = async () => {
      fetched += 1;
      return { status: 200, text: async () => "{}" };
    };
    const capture: { url?: string; socket?: ValidationSocket } = {};

    const result = await validateProviderConfig(
      store,
      fetchFn,
      "config.seed",
      validationWebSocket(capture),
    );

    expect(result.status).toBe("ok");
    expect(fetched).toBe(0);
    expect(capture.url).toBe(
      "wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen3-asr-flash-realtime",
    );
    expect(capture.socket!.sent.map((event) => (event as { type?: string }).type)).toContain(
      "input_audio_buffer.commit",
    );
  });

  it("llm: validates via a chat-completions reply-ok round trip", async () => {
    const store = makeStore({ provider_id: "mimo-api", capability: "llm", model: "" });
    const urls: string[] = [];
    const fetchFn: FetchLike = async (url) => {
      urls.push(url);
      return {
        status: 200,
        text: async () => JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
      };
    };
    const result = await validateProviderConfig(store, fetchFn, "config.seed");
    expect(result.status).toBe("ok");
    expect(urls).toEqual(["https://api.xiaomimimo.com/v1/chat/completions"]);
  });

  it("returns err with the invalid_configuration note when the vendor lacks the capability", async () => {
    // doubao-asr offers asr only — an llm-capability config over it cannot resolve.
    const store = makeStore({ provider_id: "doubao-asr", capability: "llm" });
    let fetched = 0;
    const fetchFn: FetchLike = async () => {
      fetched += 1;
      return { status: 200, text: async () => "{}" };
    };
    const result = await validateProviderConfig(store, fetchFn, "config.seed");
    expect(result.status).toBe("err");
    expect(result.note).toContain("does not support the 'llm' capability");
    expect(fetched).toBe(0); // fails at resolution, before any network round trip
  });

  it("returns err for an unknown vendor", async () => {
    const store = makeStore({ provider_id: "no-such-vendor", capability: "omni" });
    const result = await validateProviderConfig(store, okFetch, "config.seed");
    expect(result.status).toBe("err");
    expect(result.note).toContain("no-such-vendor");
  });
});
