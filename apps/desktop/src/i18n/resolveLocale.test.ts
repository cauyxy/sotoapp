import { describe, expect, it } from "vitest";

import { resolveLocale } from "./resolveLocale";
import { DEFAULT_LOCALE } from "./types";

describe("resolveLocale", () => {
  it("returns the explicit preference verbatim when it is supported", () => {
    expect(resolveLocale("zh-CN", [])).toBe("zh-CN");
    expect(resolveLocale("en-US", [])).toBe("en-US");
  });

  it("falls back to default for an unsupported persisted preference", () => {
    expect(resolveLocale("fr-FR" as unknown as "en-US", [])).toBe(DEFAULT_LOCALE);
  });

  it("system mode picks zh-CN when navigator language starts with zh", () => {
    expect(resolveLocale("system", ["zh-CN"])).toBe("zh-CN");
    expect(resolveLocale("system", ["zh-Hans-CN"])).toBe("zh-CN");
    expect(resolveLocale("system", ["zh"])).toBe("zh-CN");
  });

  it("system mode picks en-US when navigator language starts with en", () => {
    expect(resolveLocale("system", ["en-US"])).toBe("en-US");
    expect(resolveLocale("system", ["en-GB"])).toBe("en-US");
    expect(resolveLocale("system", ["en"])).toBe("en-US");
  });

  it("system mode walks through navigator.languages and picks the first match", () => {
    expect(resolveLocale("system", ["fr-FR", "ja-JP", "zh-CN"])).toBe("zh-CN");
    expect(resolveLocale("system", ["ja-JP", "en"])).toBe("en-US");
  });

  it("system mode falls back to default when no language matches a registered prefix", () => {
    expect(resolveLocale("system", ["ja-JP", "ko-KR"])).toBe(DEFAULT_LOCALE);
    expect(resolveLocale("system", [])).toBe(DEFAULT_LOCALE);
    expect(resolveLocale("system", [""])).toBe(DEFAULT_LOCALE);
  });

  it("system mode is case-insensitive against navigator.languages", () => {
    expect(resolveLocale("system", ["ZH-CN"])).toBe("zh-CN");
    expect(resolveLocale("system", ["EN-us"])).toBe("en-US");
  });
});
