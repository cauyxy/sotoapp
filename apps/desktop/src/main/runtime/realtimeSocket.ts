import WebSocket from "ws";
import { ProviderException, type WebSocketFactory, type WebSocketLike } from "@soto/core";

const DASHSCOPE_REALTIME_HOST = "dashscope.aliyuncs.com";
const DASHSCOPE_MAAS_SUFFIX = ".maas.aliyuncs.com";
const DISPOSE_CODE = 4000;
const DISPOSE_REASON = "soto session disposed";

export function assertAllowedRealtimeUrl(rawUrl: string): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ProviderException("invalid_configuration", "Realtime WebSocket URL is invalid.");
  }

  if (url.protocol !== "wss:") {
    throw new ProviderException("invalid_configuration", "Realtime WebSocket URL must use wss.");
  }

  const host = url.hostname.toLowerCase();
  if (host !== DASHSCOPE_REALTIME_HOST && !host.endsWith(DASHSCOPE_MAAS_SUFFIX)) {
    throw new ProviderException(
      "invalid_configuration",
      `Realtime WebSocket host '${url.hostname}' is not allowed.`,
    );
  }
}

export interface ManagedWebSocketFactory {
  webSocket: WebSocketFactory;
  dispose(): void;
}

class NodeWebSocketLike implements WebSocketLike {
  constructor(private readonly socket: WebSocket) {}

  send(data: string): void {
    this.socket.send(data);
  }

  close(code?: number, reason?: string): void {
    if (this.socket.readyState === WebSocket.CLOSED || this.socket.readyState === WebSocket.CLOSING) {
      return;
    }
    if (this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.terminate();
      return;
    }
    this.socket.close(code, reason);
  }

  on(event: "open", cb: () => void): void;
  on(event: "message", cb: (data: string) => void): void;
  on(event: "error", cb: (err: Error) => void): void;
  on(event: "close", cb: (code: number, reason: string) => void): void;
  on(
    event: "open" | "message" | "error" | "close",
    cb: (() => void) | ((data: string) => void) | ((err: Error) => void) | ((code: number, reason: string) => void),
  ): void {
    switch (event) {
      case "open":
        this.socket.on("open", cb as () => void);
        return;
      case "message":
        this.socket.on("message", (data) => {
          (cb as (data: string) => void)(typeof data === "string" ? data : data.toString("utf8"));
        });
        return;
      case "error":
        this.socket.on("error", cb as (err: Error) => void);
        return;
      case "close":
        this.socket.on("close", (code, reason) => {
          (cb as (code: number, reason: string) => void)(code, reason.toString("utf8"));
        });
        return;
    }
  }
}

export function createManagedDashscopeRealtimeWebSocketFactory(): ManagedWebSocketFactory {
  const sockets = new Set<WebSocket>();

  const webSocket: WebSocketFactory = (url, opts) => {
    assertAllowedRealtimeUrl(url);
    const socket = new WebSocket(url, { headers: opts.headers });
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    return new NodeWebSocketLike(socket);
  };

  return {
    webSocket,
    dispose: () => {
      for (const socket of [...sockets]) {
        if (socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
          continue;
        }
        if (socket.readyState === WebSocket.CONNECTING) {
          socket.terminate();
        } else {
          socket.close(DISPOSE_CODE, DISPOSE_REASON);
        }
      }
      sockets.clear();
    },
  };
}
