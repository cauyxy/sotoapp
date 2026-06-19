import { describe, expect, it, vi } from "vitest";
import { encodeWav, pcm16ToWavBase64 } from "../../../foundation/audio/wav.js";
import { base64ToBytes, type AsrClientConfig } from "./openaiCompatAsr.js";
import {
  createDashscopeRealtimeAsr,
  DASHSCOPE_REALTIME_CHUNK_BYTES,
  parsePcm16Mono16kWav,
} from "./dashscopeRealtimeAsr.js";
import type { WebSocketFactory, WebSocketLike } from "../realtime/socket.js";

const config: AsrClientConfig = {
  providerId: "dashscope-realtime",
  apiKey: "secret-key",
  model: "qwen3-asr-flash-realtime",
  baseUrl: "wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
};

type WsEvent = "open" | "message" | "error" | "close";

class ScriptedSocket implements WebSocketLike {
  readonly sent: unknown[] = [];
  readonly closeCalls: Array<{ code?: number; reason?: string }> = [];
  private readonly handlers: Record<WsEvent, ((...args: never[]) => void)[]> = {
    open: [],
    message: [],
    error: [],
    close: [],
  };

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(code?: number, reason?: string): void {
    const call: { code?: number; reason?: string } = {};
    if (code !== undefined) call.code = code;
    if (reason !== undefined) call.reason = reason;
    this.closeCalls.push(call);
  }

  on(event: "open", cb: () => void): void;
  on(event: "message", cb: (data: string) => void): void;
  on(event: "error", cb: (err: Error) => void): void;
  on(event: "close", cb: (code: number, reason: string) => void): void;
  on(event: WsEvent, cb: (...args: never[]) => void): void {
    this.handlers[event].push(cb);
  }

  message(event: unknown): void {
    for (const cb of this.handlers.message) {
      (cb as (data: string) => void)(JSON.stringify(event));
    }
  }

  error(err: Error): void {
    for (const cb of this.handlers.error) {
      (cb as (err: Error) => void)(err);
    }
  }

  closed(code = 1006, reason = ""): void {
    for (const cb of this.handlers.close) {
      (cb as (code: number, reason: string) => void)(code, reason);
    }
  }
}

function socketFactory(capture: {
  socket?: ScriptedSocket;
  url?: string;
  headers?: Record<string, string>;
}): WebSocketFactory {
  return (url, opts) => {
    capture.url = url;
    capture.headers = opts.headers;
    capture.socket = new ScriptedSocket();
    return capture.socket;
  };
}

function wavBase64(samples = 2000): string {
  return pcm16ToWavBase64(new Int16Array(samples), { sampleRate: 16_000, channels: 1 });
}

function typed<T extends { type: string }>(socket: ScriptedSocket, type: string): T[] {
  return socket.sent.filter((event): event is T => {
    return typeof event === "object" && event !== null && (event as { type?: unknown }).type === type;
  });
}

describe("parsePcm16Mono16kWav", () => {
  it("strips the WAV container and returns raw PCM bytes", () => {
    const bytes = base64ToBytes(wavBase64(4));
    const parsed = parsePcm16Mono16kWav(bytes);
    expect(parsed.sampleRate).toBe(16_000);
    expect(parsed.channels).toBe(1);
    expect(parsed.bitsPerSample).toBe(16);
    expect(parsed.pcm).toHaveLength(8);
  });

  it("rejects non-16k-mono-PCM16 WAV payloads", () => {
    const bad = encodeWav(new Int16Array(4), { sampleRate: 8000, channels: 1 });
    expect(() => parsePcm16Mono16kWav(bad)).toThrow(/16 kHz mono PCM16/u);
  });
});

describe("createDashscopeRealtimeAsr", () => {
  it("opens the realtime socket, updates the session, chunks PCM, and resolves the completed transcript", async () => {
    const capture: { socket?: ScriptedSocket; url?: string; headers?: Record<string, string> } = {};
    const asr = createDashscopeRealtimeAsr(config, { webSocket: socketFactory(capture) });

    const pending = asr.transcribe(
      { audioB64: wavBase64(2000), audioFormat: "wav" },
      { hotwords: ["Soto", "Qwen"], languageHint: null },
    );

    const socket = capture.socket!;
    expect(capture.url).toBe(
      "wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen3-asr-flash-realtime",
    );
    expect(capture.headers).toEqual({
      Authorization: "Bearer secret-key",
      "OpenAI-Beta": "realtime=v1",
    });

    socket.message({ type: "session.created" });
    expect(socket.sent[0]).toMatchObject({
      type: "session.update",
      session: {
        modalities: ["text"],
        input_audio_format: "pcm",
        input_audio_transcription: { model: "qwen3-asr-flash-realtime" },
        turn_detection: null,
      },
    });
    expect((socket.sent[0] as { session: { instructions: string } }).session.instructions).toContain("Soto");

    socket.message({ type: "session.updated" });
    const appends = typed<{ type: "input_audio_buffer.append"; audio: string }>(
      socket,
      "input_audio_buffer.append",
    );
    expect(appends).toHaveLength(2);
    expect(base64ToBytes(appends[0]!.audio)).toHaveLength(DASHSCOPE_REALTIME_CHUNK_BYTES);
    expect(base64ToBytes(appends[1]!.audio)).toHaveLength(800);
    expect(typed(socket, "input_audio_buffer.commit")).toHaveLength(1);
    expect(typed(socket, "response.create")).toHaveLength(0);

    socket.message({ type: "conversation.item.input_audio_transcription.delta", delta: "hello" });
    socket.message({ type: "conversation.item.input_audio_transcription.completed", transcript: " hello " });

    await expect(pending).resolves.toEqual({ text: "hello" });
    expect(socket.closeCalls).toHaveLength(1);
  });

  it("sends response.create for omni realtime models", async () => {
    const capture: { socket?: ScriptedSocket } = {};
    const asr = createDashscopeRealtimeAsr(
      { ...config, model: "qwen3.5-omni-flash-realtime" },
      { webSocket: socketFactory(capture) },
    );

    const pending = asr.transcribe(
      { audioB64: wavBase64(1), audioFormat: "wav" },
      { hotwords: [], languageHint: null },
    );
    const socket = capture.socket!;
    socket.message({ type: "session.created" });
    socket.message({ type: "session.updated" });
    expect(typed(socket, "response.create")).toHaveLength(1);
    socket.message({ type: "conversation.item.input_audio_transcription.completed", transcript: "" });

    await expect(pending).resolves.toEqual({ text: "" });
  });

  it("accepts response.done as an omni-model completion fallback", async () => {
    const capture: { socket?: ScriptedSocket } = {};
    const asr = createDashscopeRealtimeAsr(
      { ...config, model: "qwen3.5-omni-plus-realtime" },
      { webSocket: socketFactory(capture) },
    );

    const pending = asr.transcribe(
      { audioB64: wavBase64(1), audioFormat: "wav" },
      { hotwords: [], languageHint: null },
    );
    const socket = capture.socket!;
    socket.message({ type: "session.created" });
    socket.message({ type: "session.updated" });
    socket.message({ type: "conversation.item.input_audio_transcription.delta", delta: "ok" });
    socket.message({ type: "response.done" });

    await expect(pending).resolves.toEqual({ text: "ok" });
  });

  it("falls back to accumulated deltas when the completed event has no transcript field", async () => {
    const capture: { socket?: ScriptedSocket } = {};
    const asr = createDashscopeRealtimeAsr(config, { webSocket: socketFactory(capture) });

    const pending = asr.transcribe(
      { audioB64: wavBase64(1), audioFormat: "wav" },
      { hotwords: [], languageHint: null },
    );
    const socket = capture.socket!;
    socket.message({ type: "session.created" });
    socket.message({ type: "session.updated" });
    socket.message({ type: "conversation.item.input_audio_transcription.delta", delta: "hel" });
    socket.message({ type: "conversation.item.input_audio_transcription.delta", delta: "lo" });
    socket.message({ type: "conversation.item.input_audio_transcription.completed" });

    await expect(pending).resolves.toEqual({ text: "hello" });
  });

  it("maps provider error events to ProviderException(request_failed)", async () => {
    const capture: { socket?: ScriptedSocket } = {};
    const asr = createDashscopeRealtimeAsr(config, { webSocket: socketFactory(capture) });

    const pending = asr.transcribe(
      { audioB64: wavBase64(1), audioFormat: "wav" },
      { hotwords: [], languageHint: null },
    );
    capture.socket!.message({ type: "error", error: { message: "bad key" } });

    await expect(pending).rejects.toMatchObject({ code: "request_failed" });
  });

  it("times out and closes the socket", async () => {
    vi.useFakeTimers();
    try {
      const capture: { socket?: ScriptedSocket } = {};
      const asr = createDashscopeRealtimeAsr(config, {
        webSocket: socketFactory(capture),
        timeoutMs: 10,
      });

      const pending = asr.transcribe(
        { audioB64: wavBase64(1), audioFormat: "wav" },
        { hotwords: [], languageHint: null },
      );
      const rejection = expect(pending).rejects.toMatchObject({ code: "request_failed" });
      await vi.advanceTimersByTimeAsync(10);

      await rejection;
      expect(capture.socket!.closeCalls).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects before connecting when no WebSocket factory is available", async () => {
    const asr = createDashscopeRealtimeAsr(config, {});
    await expect(
      asr.transcribe({ audioB64: wavBase64(1), audioFormat: "wav" }, { hotwords: [], languageHint: null }),
    ).rejects.toMatchObject({ code: "invalid_configuration" });
  });
});
