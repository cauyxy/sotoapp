import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const homePageSource = readFileSync(new URL("./HomePage.svelte", import.meta.url), "utf8");

describe("home page view contract", () => {
  it("does not render the microphone status pill in the hero", () => {
    expect(homePageSource).not.toContain("Default microphone");
    expect(homePageSource).not.toContain("status-pill");
    expect(homePageSource).not.toContain("../../shared/ui/Waveform");
  });
});
