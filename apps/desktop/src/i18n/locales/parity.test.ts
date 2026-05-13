import { describe, expect, it } from "vitest";

import en from "./en-US";
import zh from "./zh-CN";

type Tree = { [key: string]: string | Tree };

function flatten(node: Tree, prefix = ""): Map<string, string> {
  const result = new Map<string, string>();
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      result.set(path, value);
    } else {
      for (const [innerPath, innerValue] of flatten(value, path)) {
        result.set(innerPath, innerValue);
      }
    }
  }
  return result;
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{\{([^}]+)\}\}/g)].map((match) => match[1].trim()).sort();
}

describe("locale parity", () => {
  const flatEn = flatten(en as unknown as Tree);
  const flatZh = flatten(zh as unknown as Tree);

  it("zh-CN exposes the same keys as en-US", () => {
    expect([...flatZh.keys()].sort()).toEqual([...flatEn.keys()].sort());
  });

  it("interpolation tokens match across locales", () => {
    const mismatches: string[] = [];
    for (const [key, enValue] of flatEn) {
      const zhValue = flatZh.get(key) ?? "";
      const enTokens = placeholders(enValue);
      const zhTokens = placeholders(zhValue);
      if (enTokens.join("|") !== zhTokens.join("|")) {
        mismatches.push(`${key}: en=[${enTokens.join(",")}] zh=[${zhTokens.join(",")}]`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});
