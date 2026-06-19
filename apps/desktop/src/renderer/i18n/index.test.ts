import { describe, expect, it } from "vitest";

import { buildTranslator, ensureLocale } from "./index";

const locales = ["zh-CN", "en-US"] as const;

describe("buildTranslator", () => {
  it("resolves a known key in the default locale", () => {
    const t = buildTranslator("en-US");
    expect(t("capsule.gotIt")).not.toBe("capsule.gotIt");
  });

  it("falls back to the key when missing", () => {
    const t = buildTranslator("en-US");
    expect(t("nonexistent.key.path")).toBe("nonexistent.key.path");
  });

  it("exposes the promoted home stat labels", async () => {
    for (const locale of locales) {
      await ensureLocale(locale);
      const t = buildTranslator(locale);
      expect(t("home.stats.aria")).not.toBe("home.stats.aria");
      expect(t("home.stats.chars")).not.toBe("home.stats.chars");
      expect(t("home.stats.sessions")).not.toBe("home.stats.sessions");
      expect(t("home.stats.avg")).not.toBe("home.stats.avg");
    }
  });

  it("drops the retired inlay / today-stats / ready copy", async () => {
    for (const locale of locales) {
      await ensureLocale(locale);
      const t = buildTranslator(locale);
      expect(t("home.todayStats")).toBe("home.todayStats");
      const retiredInlayAriaKey = ["home", "inlay", "aria"].join(".");
      expect(t(retiredInlayAriaKey)).toBe(retiredInlayAriaKey);
      expect(t("home.readiness.ready")).toBe("home.readiness.ready");
    }
  });
});
