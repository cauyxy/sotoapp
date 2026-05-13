import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./SearchToggle.svelte", import.meta.url), "utf8");

describe("SearchToggle", () => {
  it("owns the bindable query prop and clear-on-close behavior", () => {
    expect(source).toMatch(/query = \$bindable\(\)/);
    expect(source).toMatch(/query = \"\";/);
  });

  it("renders two states with one icon and one input-close mode", () => {
    expect(source).toMatch(/let open = \$state\(false\)/);
    expect(source).toMatch(/page-filter-search-open/);
    expect(source).toMatch(/page-filter-search-close/);
    expect(source).toMatch(/page-filter-search-icon-btn/);
  });

  it("uses aria labels for open and close states", () => {
    expect(source).toMatch(/ariaOpen/);
    expect(source).toMatch(/ariaClose/);
    expect(source).toMatch(/aria-label=\{ariaOpen\}/);
    expect(source).toMatch(/aria-label=\{ariaClose\}/);
  });
});
