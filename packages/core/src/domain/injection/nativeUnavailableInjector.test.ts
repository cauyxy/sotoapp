import { describe, expect, it } from "vitest";

import { createNativeUnavailableInjector } from "./nativeUnavailableInjector.js";

describe("createNativeUnavailableInjector", () => {
  it("always returns manual_copy_required with reason native_unavailable", async () => {
    const injector = createNativeUnavailableInjector();
    const outcome = await injector.inject("hello", null, {
      app: null,
      windowTitle: null,
      controlType: null,
    });

    expect(outcome).toEqual({
      kind: "manual_copy_required",
      reason: "native_unavailable",
    });
  });
});
