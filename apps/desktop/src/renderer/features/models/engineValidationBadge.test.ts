import { describe, expect, it } from "vitest";

import type { ProviderConfig } from "@soto/core";
import type { Translator } from "../../i18n";
import { deriveValidationBadge } from "./engineValidationBadge.js";

type Validation = ProviderConfig["validation"];

// Echoing translator: returns "key" or "key|var=val,..." so assertions can see
// both which key was hit and the interpolation args, without pulling in the
// real locale catalog.
const t: Translator = (key, options) => {
  if (!options) return key;
  const parts = Object.entries(options)
    .map(([name, value]) => `${name}=${String(value)}`)
    .join(",");
  return `${key}|${parts}`;
};

function validation(overrides: Partial<Validation>): Validation {
  return {
    last_validated_at: null,
    last_validated_latency_ms: null,
    last_validated_status: "unspecified",
    last_validated_note: null,
    last_validated_sample: null,
    last_validated_sample_result: null,
    ...overrides,
  };
}

describe("deriveValidationBadge", () => {
  it("returns the neutral unverified badge when validation is missing", () => {
    expect(deriveValidationBadge(undefined, t)).toEqual({
      kind: "warn",
      text: "settings.engine.slot.badgeUnverified",
      tooltip: "",
    });
  });

  it("treats 'unspecified' and 'warn' as unverified", () => {
    for (const status of ["unspecified", "warn"] as const) {
      expect(deriveValidationBadge(validation({ last_validated_status: status }), t)).toEqual({
        kind: "warn",
        text: "settings.engine.slot.badgeUnverified",
        tooltip: "",
      });
    }
  });

  it("stamps the latency into the verified badge for 'ok'", () => {
    const badge = deriveValidationBadge(
      validation({ last_validated_status: "ok", last_validated_latency_ms: 142 }),
      t,
    );
    expect(badge.kind).toBe("ok");
    expect(badge.text).toBe("settings.engine.slot.badgeVerified|ms=142");
  });

  it("defaults the verified latency to 0 when it is null", () => {
    const badge = deriveValidationBadge(
      validation({ last_validated_status: "ok", last_validated_latency_ms: null }),
      t,
    );
    expect(badge.text).toBe("settings.engine.slot.badgeVerified|ms=0");
  });

  it("adds a 'verified at' tooltip when a timestamp is present", () => {
    const at = BigInt(1_700_000_000_000);
    const badge = deriveValidationBadge(
      validation({ last_validated_status: "ok", last_validated_at: at }),
      t,
    );
    const expectedWhen = new Date(Number(at)).toLocaleString();
    expect(badge.tooltip).toBe(`settings.engine.slot.badgeVerifiedAt|when=${expectedWhen}`);
  });

  it("leaves the verified tooltip empty when there is no timestamp", () => {
    const badge = deriveValidationBadge(
      validation({ last_validated_status: "ok", last_validated_at: null }),
      t,
    );
    expect(badge.tooltip).toBe("");
  });

  it("returns the failed badge with the note as tooltip for 'err'", () => {
    const badge = deriveValidationBadge(
      validation({ last_validated_status: "err", last_validated_note: "401 Unauthorized" }),
      t,
    );
    expect(badge).toEqual({
      kind: "err",
      text: "settings.engine.slot.badgeFailed",
      tooltip: "401 Unauthorized",
    });
  });

  it("falls back to an empty tooltip when the failed note is null", () => {
    const badge = deriveValidationBadge(
      validation({ last_validated_status: "err", last_validated_note: null }),
      t,
    );
    expect(badge.tooltip).toBe("");
  });
});
