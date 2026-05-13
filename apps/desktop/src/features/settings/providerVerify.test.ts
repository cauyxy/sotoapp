import { get } from "svelte/store";
import { describe, expect, it, vi } from "vitest";

import type { ProviderConfig, ProviderTestResult } from "../../ipc/providers";
import { createProviderVerify } from "./providerVerify";

function fakeSaved(): ProviderConfig {
  return {
    config_id: "cfg.test",
    provider_id: "mimo-plan-sea",
    display_name: null,
    model: "mimo-v2.5",
    base_url: null,
    is_default: true,
    validation: {
      last_validated_at: null,
      last_validated_latency_ms: null,
      last_validated_status: "unspecified",
      last_validated_note: null,
      last_validated_sample: null,
      last_validated_sample_result: null
    },
    created_at: "2026-05-12T00:00:00Z",
    updated_at: "2026-05-12T00:00:00Z"
  };
}

function draft() {
  return {
    config_id: "cfg.test",
    provider_id: "mimo-plan-sea",
    display_name: "",
    model: "mimo-v2.5",
    base_url: "",
    api_key: "abc",
    is_default: true
  };
}

describe("provider verify state", () => {
  it("returns ok result with latency and note from test result", async () => {
    const { state, verify } = createProviderVerify({
      getDraft: draft,
      setDraft: () => {},
      save: async () => fakeSaved(),
      test: async (): Promise<ProviderTestResult> => ({
        config_id: "cfg.test",
        status: "ok",
        note: "Polish OK",
        latency_ms: 421
      }),
      errorContext: "test"
    });

    const result = await verify();

    expect(result).toEqual({
      kind: "ok",
      latency_ms: 421,
      note: "Polish OK",
      saved: fakeSaved()
    });
    expect(get(state)).toEqual({ kind: "idle" });
  });

  it("returns verify_failed when status is not ok", async () => {
    const { state, verify } = createProviderVerify({
      getDraft: draft,
      setDraft: () => {},
      save: async () => fakeSaved(),
      test: async (): Promise<ProviderTestResult> => ({
        config_id: "cfg.test",
        status: "err",
        note: "Bad API key",
        latency_ms: 777
      }),
      errorContext: "test"
    });

    const result = await verify();

    expect(result).toEqual({
      kind: "verify_failed",
      latency_ms: 777,
      note: "Bad API key",
      saved: fakeSaved()
    });
    expect(get(state)).toEqual({ kind: "idle" });
  });

  it("returns save_failed on thrown exception", async () => {
    const { state, verify } = createProviderVerify({
      getDraft: draft,
      setDraft: () => {},
      save: async () => fakeSaved(),
      test: async () => {
        throw new Error("nope");
      },
      errorContext: "test"
    });

    const result = await verify();

    expect(result.kind).toBe("save_failed");
    if (result.kind === "save_failed") {
      expect(result.note).toBe("nope");
    }
    expect(get(state)).toEqual({ kind: "idle" });
  });

  it("returns timed_out when save exceeds timeout", async () => {
    vi.useFakeTimers();
    const { state, verify } = createProviderVerify({
      getDraft: draft,
      setDraft: () => {},
      save: () => new Promise(() => {}),
      test: async () => ({
        config_id: "cfg.test",
        status: "ok",
        note: "",
        latency_ms: 0
      }),
      errorContext: "test",
      timeoutMs: 10
    });

    const pending = verify();
    vi.advanceTimersByTime(20);
    const result = await pending;

    expect(result).toEqual({
      kind: "timed_out",
      saved: null
    });
    expect(get(state)).toEqual({ kind: "idle" });
    vi.useRealTimers();
  });

  it("holds terminal state only in transition state", async () => {
    const { state, verify } = createProviderVerify({
      getDraft: draft,
      setDraft: () => {},
      save: async () => fakeSaved(),
      test: async (): Promise<ProviderTestResult> => ({
        config_id: "cfg.test",
        status: "ok",
        note: "Polish OK",
        latency_ms: 421
      }),
      errorContext: "test"
    });

    const pending = verify();
    expect(get(state)).toEqual({ kind: "running" });
    await pending;
    expect(get(state)).toEqual({ kind: "idle" });
  });
});
