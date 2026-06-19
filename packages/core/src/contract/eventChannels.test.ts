import { describe, expect, it } from "vitest";
import { VOICE_RUNTIME_EVENT } from "./schema.js";
import { validateOutboundEvent } from "./eventChannels.js";

describe("validateOutboundEvent", () => {
  it("accepts a valid voice-runtime event", () => {
    const result = validateOutboundEvent(VOICE_RUNTIME_EVENT, {
      kind: "level",
      rms: 100,
      peak: 200,
    });

    expect(result.ok).toBe(true);
  });

  it("rejects an out-of-range level", () => {
    const result = validateOutboundEvent(VOICE_RUNTIME_EVENT, {
      kind: "level",
      rms: 70000,
      peak: 1,
    });

    expect(result.ok).toBe(false);
  });

  it("passes through channels with no registered schema", () => {
    const result = validateOutboundEvent("alert:show", { anything: true });

    expect(result.ok).toBe(true);
  });
});
