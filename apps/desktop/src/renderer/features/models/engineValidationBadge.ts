// Pure derivation of the Models page's validation badge. Maps a provider
// config's last-validation record into the badge's {kind, text, tooltip} the
// card renders. No React / IPC: a `validation` record + translator in, plain
// data out, so it is unit-testable without mounting the panel.

import type { ProviderConfig } from "@soto/core";
import type { Translator } from "../../i18n";

export type ValidationBadgeKind = "ok" | "warn" | "err";

export interface ValidationBadge {
  kind: ValidationBadgeKind;
  text: string;
  tooltip: string;
}

/**
 * Derive the verification badge from a config's validation record.
 *
 * - missing record / "unspecified" / "warn" → neutral "not verified" badge
 * - "ok" → verified badge stamped with latency (+ optional "verified at" tooltip)
 * - anything else ("err") → failed badge with the note as tooltip
 */
export function deriveValidationBadge(
  validation: ProviderConfig["validation"] | undefined,
  t: Translator,
): ValidationBadge {
  if (
    !validation ||
    validation.last_validated_status === "unspecified" ||
    validation.last_validated_status === "warn"
  ) {
    return { kind: "warn", text: t("settings.engine.slot.badgeUnverified"), tooltip: "" };
  }
  if (validation.last_validated_status === "ok") {
    return {
      kind: "ok",
      text: t("settings.engine.slot.badgeVerified", {
        ms: validation.last_validated_latency_ms ?? 0,
      }),
      tooltip:
        validation.last_validated_at != null
          ? t("settings.engine.slot.badgeVerifiedAt", {
              when: new Date(Number(validation.last_validated_at)).toLocaleString(),
            })
          : "",
    };
  }
  return {
    kind: "err",
    text: t("settings.engine.slot.badgeFailed"),
    tooltip: validation.last_validated_note ?? "",
  };
}
