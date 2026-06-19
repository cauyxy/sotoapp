import { describe, expect, it } from "vitest";

import { externalOpenTarget } from "./externalLink.pure.js";

describe("externalOpenTarget", () => {
  it("hands https URLs to the OS browser", () => {
    expect(
      externalOpenTarget("https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey"),
    ).toBe("https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey");
    expect(
      externalOpenTarget("https://bailian.console.aliyun.com/cn-beijing?tab=model#/api-key"),
    ).toBe("https://bailian.console.aliyun.com/cn-beijing?tab=model#/api-key");
  });

  it("refuses non-https schemes (http, file, javascript, custom)", () => {
    expect(externalOpenTarget("http://example.com")).toBeNull();
    expect(externalOpenTarget("file:///etc/passwd")).toBeNull();
    expect(externalOpenTarget("javascript:alert(1)")).toBeNull();
    expect(externalOpenTarget("ftp://example.com/x")).toBeNull();
    expect(externalOpenTarget("about:blank")).toBeNull();
  });

  it("refuses empty or malformed input", () => {
    expect(externalOpenTarget("")).toBeNull();
    expect(externalOpenTarget("   ")).toBeNull();
    expect(externalOpenTarget("not a url")).toBeNull();
  });
});
