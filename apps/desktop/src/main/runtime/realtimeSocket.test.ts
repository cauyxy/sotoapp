import { describe, expect, it } from "vitest";
import { assertAllowedRealtimeUrl } from "./realtimeSocket.js";

describe("assertAllowedRealtimeUrl", () => {
  it("allows the DashScope realtime host and maas workspace hosts over wss", () => {
    expect(() =>
      assertAllowedRealtimeUrl("wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=x"),
    ).not.toThrow();
    expect(() =>
      assertAllowedRealtimeUrl("wss://workspace.maas.aliyuncs.com/api-ws/v1/realtime?model=x"),
    ).not.toThrow();
  });

  it("rejects non-wss URLs and unlisted hosts", () => {
    expect(() =>
      assertAllowedRealtimeUrl("https://dashscope.aliyuncs.com/api-ws/v1/realtime?model=x"),
    ).toThrow(/wss/u);
    expect(() =>
      assertAllowedRealtimeUrl("wss://example.com/api-ws/v1/realtime?model=x"),
    ).toThrow(/not allowed/u);
  });
});
