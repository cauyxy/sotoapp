import { describe, it, expect } from "vitest";
import { dmgUrlFor, dmgFileNameFor } from "./dmgUrl";

describe("dmgUrlFor", () => {
  it("constructs the canonical R2 dmg URL", () => {
    expect(dmgUrlFor("0.3.1")).toBe(
      "https://soto-installer.sotoapp.org/artifacts/0.3.1/darwin-aarch64/Soto_0.3.1_darwin_aarch64.dmg"
    );
  });

  it("handles a different version", () => {
    expect(dmgUrlFor("1.0.0")).toBe(
      "https://soto-installer.sotoapp.org/artifacts/1.0.0/darwin-aarch64/Soto_1.0.0_darwin_aarch64.dmg"
    );
  });

  it("strips a leading 'v' from the version", () => {
    expect(dmgUrlFor("v0.3.1")).toBe(
      "https://soto-installer.sotoapp.org/artifacts/0.3.1/darwin-aarch64/Soto_0.3.1_darwin_aarch64.dmg"
    );
  });
});

describe("dmgFileNameFor", () => {
  it("returns the canonical dmg file name", () => {
    expect(dmgFileNameFor("0.3.1")).toBe("Soto_0.3.1_darwin_aarch64.dmg");
  });
});
