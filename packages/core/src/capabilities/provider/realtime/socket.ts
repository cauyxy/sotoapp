export interface WebSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: "open", cb: () => void): void;
  on(event: "message", cb: (data: string) => void): void;
  on(event: "error", cb: (err: Error) => void): void;
  on(event: "close", cb: (code: number, reason: string) => void): void;
}

export type WebSocketFactory = (
  url: string,
  opts: { headers: Record<string, string> },
) => WebSocketLike;
