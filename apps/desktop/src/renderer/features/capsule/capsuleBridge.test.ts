import { afterEach, describe, expect, it, vi } from "vitest";

import { getCapsuleBridge } from "./capsuleBridge";

describe("getCapsuleBridge", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null when the preload bridge is missing", () => {
    vi.stubGlobal("window", {});

    expect(getCapsuleBridge()).toBeNull();
  });

  it("returns the preload bridge when capsule methods are present", () => {
    const off = () => {};
    const bridge = {
      onVoiceRuntime: () => off,
      onCaptureControl: () => off,
      capture_started: async () => undefined,
      push_capture_audio: async () => undefined,
      push_capture_level: async () => undefined,
      report_capture_error: async () => undefined,
    };
    vi.stubGlobal("window", { soto: bridge });

    expect(getCapsuleBridge()).toBe(bridge);
  });
});
