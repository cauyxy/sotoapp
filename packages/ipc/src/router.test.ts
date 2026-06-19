import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { IpcRouter, defineCommand } from "./router.js";

const echoHandler = vi.fn((input: { text: string }) => `echo:${input.text}`);
const cancelHandler = vi.fn(() => "cancelled");

function makeRegistry() {
  echoHandler.mockClear();
  cancelHandler.mockClear();
  return {
    echo: defineCommand({
      input: z.object({ text: z.string() }),
      allowedWindows: ["main"],
      handler: echoHandler,
    }),
    cancelDictation: defineCommand({
      input: z.object({ sessionId: z.string() }),
      allowedWindows: ["main", "capsule"],
      handler: cancelHandler,
    }),
  };
}

const registry = makeRegistry();

describe("IpcRouter", () => {
  it("dispatches a known command with valid args, calling the handler with parsed input", async () => {
    const router = new IpcRouter(registry);

    const result = await router.dispatch("echo", { text: "hi" }, { window: "main" });

    expect(result).toEqual({ ok: true, value: "echo:hi" });
  });

  it("rejects an unknown command without inventing a handler", async () => {
    const router = new IpcRouter(makeRegistry());
    const result = await router.dispatch("dropDatabase", {}, { window: "main" });
    expect(result).toEqual({ ok: false, error: "unknown_command" });
  });

  it("rejects invalid input and never calls the handler", async () => {
    const router = new IpcRouter(makeRegistry());

    const result = await router.dispatch("echo", { text: 42 }, { window: "main" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_input");
    expect(echoHandler).not.toHaveBeenCalled();
  });

  it("forbids a command the calling window is not allowed to use (capsule -> main-only)", async () => {
    const router = new IpcRouter(makeRegistry());

    const result = await router.dispatch("echo", { text: "hi" }, { window: "capsule" });

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(echoHandler).not.toHaveBeenCalled();
  });

  it("checks authorization before validation (forbidden beats invalid_input)", async () => {
    const router = new IpcRouter(makeRegistry());
    const result = await router.dispatch("echo", { text: 42 }, { window: "capsule" });
    expect(result).toEqual({ ok: false, error: "forbidden" });
  });

  it("allows a capsule-permitted command from the capsule window", async () => {
    const router = new IpcRouter(makeRegistry());

    const result = await router.dispatch("cancelDictation", { sessionId: "s1" }, { window: "capsule" });

    expect(result).toEqual({ ok: true, value: "cancelled" });
    expect(cancelHandler).toHaveBeenCalledWith({ sessionId: "s1" }, { window: "capsule" });
  });

  it("wraps a throwing handler as handler_error", async () => {
    const router = new IpcRouter({
      boom: defineCommand({
        input: z.object({}),
        allowedWindows: ["main"],
        handler: () => {
          throw new Error("kaboom");
        },
      }),
    });

    const result = await router.dispatch("boom", {}, { window: "main" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("handler_error");
  });
});
