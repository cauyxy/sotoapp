import { describe, expect, it } from "vitest";
import { DEFAULT_APP_PROFILE_RULES, resolveAppProfile } from "./appProfile.js";

describe("resolveAppProfile", () => {
  it("matches code editors and terminals by bundle id", () => {
    expect(
      resolveAppProfile(
        { bundleId: "com.microsoft.VSCode", appName: "Code" },
        DEFAULT_APP_PROFILE_RULES,
      ),
    ).toEqual({ registerHint: "code", punctuationStyle: "light" });
  });

  it("matches formal writing surfaces by web domain", () => {
    expect(
      resolveAppProfile({ webDomain: "docs.google.com" }, DEFAULT_APP_PROFILE_RULES),
    ).toEqual({
      registerHint: "formal",
      punctuationStyle: "standard",
      structuredBias: true,
    });
  });

  it("returns undefined when no controlled profile rule matches", () => {
    expect(resolveAppProfile({ bundleId: "com.example.Unknown" }, DEFAULT_APP_PROFILE_RULES)).toBeUndefined();
  });

  it("prioritizes bundle id over domain and title matches across rules", () => {
    expect(
      resolveAppProfile(
        {
          bundleId: "com.example.App",
          appName: "Example",
          windowTitle: "Docs",
          webDomain: "docs.example.com",
        },
        [
          {
            match: { domains: ["docs.example.com"] },
            profile: { registerHint: "formal" },
          },
          {
            match: { titlePatterns: ["Docs"] },
            profile: { registerHint: "casual" },
          },
          {
            match: { bundleIds: ["com.example.App"] },
            profile: { registerHint: "code" },
          },
        ],
      ),
    ).toEqual({ registerHint: "code" });
  });

  it("matches executable names after domain and before title fallbacks", () => {
    expect(
      resolveAppProfile(
        {
          executableName: "Code.exe",
          windowTitle: "Code",
        },
        [
          {
            match: { titlePatterns: ["Code"] },
            profile: { registerHint: "casual" },
          },
          {
            match: { executableNames: ["Code.exe"] },
            profile: { registerHint: "code" },
          },
        ],
      ),
    ).toEqual({ registerHint: "code" });
  });
});
