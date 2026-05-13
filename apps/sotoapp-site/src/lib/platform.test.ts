import { describe, it, expect } from "vitest";
import { detectPlatform } from "./platform";

describe("detectPlatform", () => {
  it("returns 'darwin' for macOS user agents", () => {
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
    expect(detectPlatform(ua)).toBe("darwin");
  });

  it("returns 'darwin' for iPad user agents (Apple Silicon iPad reports as Macintosh on desktop sites)", () => {
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
    expect(detectPlatform(ua)).toBe("darwin");
  });

  it("returns 'windows' for Windows user agents", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
    expect(detectPlatform(ua)).toBe("windows");
  });

  it("returns 'unknown' for Linux user agents", () => {
    const ua = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36";
    expect(detectPlatform(ua)).toBe("unknown");
  });

  it("returns 'unknown' for empty input", () => {
    expect(detectPlatform("")).toBe("unknown");
  });
});
