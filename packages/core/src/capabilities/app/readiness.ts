// App readiness — the pure judgement of "can the user dictate right now, and if
// not, exactly what's missing." This is the single source of truth the Home
// surface renders (blockers + fix entries) and the main process samples; it
// must never disagree with the live session path, so the active-provider rule
// (resolveActiveProviderConfigId) is shared verbatim with makeResolveSession.
//
// Pure / data-in-data-out: no Electron, no IO, no clock.

import type { AppSettings, Capability, Mode, ProviderConfig } from "../../contract/schema.js";

/** A single reason the app is not ready to dictate, with the data to fix it. */
export type AppReadinessBlocker =
  | { kind: "missing_provider" }
  | { kind: "provider_unverified"; configId: string }
  | { kind: "missing_mode" }
  | { kind: "missing_hotkey"; modeId: string }
  | { kind: "microphone_permission_denied" }
  | { kind: "accessibility_permission_denied" }
  | { kind: "native_runtime_unavailable" };

export type AppReadiness =
  | { state: "ready"; currentModeId: string; providerConfigId: string }
  | { state: "blocked"; blockers: AppReadinessBlocker[] };

/** Structural subset of a permission status row (pane + grant flag + status kind). */
export interface ReadinessPermission {
  pane: string;
  granted: boolean;
  /** Native status kind when known. "unknown" means the query failed or is a
   *  platform placeholder (e.g. the Windows microphone stub returns it), which
   *  must NOT be treated as a denial — see permissionBlocks. */
  status?: string;
}

export interface ReadinessInput {
  settings: Pick<
    AppSettings,
    | "active_provider_config_id"
    | "current_mode_id"
    | "engine_mode"
    | "active_asr_config_id"
    | "active_llm_config_id"
  >;
  modes: readonly Mode[];
  providerConfigs: readonly ProviderConfig[];
  permissions: readonly ReadinessPermission[];
  /** Whether the native bridge/facilities loaded (false = stub: no hotkey/inject). */
  nativeRuntimeAvailable: boolean;
}

/** The canonical default mode id (mirrors @soto/core mode catalog's first entry). */
const DEFAULT_MODE_ID = "default";

/** Provider validation states that count as "verified enough" to dictate. */
const VERIFIED_STATUSES: ReadonlySet<string> = new Set(["ok", "warn"]);

/**
 * Resolve which OMNI provider config is active. Explicit selection wins (when
 * it still exists); otherwise the single default-flagged config. Crucially it
 * does NOT fall back to an arbitrary first config — that implicit pick is
 * exactly what the architecture reset removes, so an absent/dangling selection
 * surfaces as `missing_provider` instead of silently using some other provider.
 * Only omni-capability configs are considered: `active_provider_config_id`
 * means "active omni config" (engine spec §3.4), so neither the explicit
 * selection nor the default-flag fallback may land on an asr/llm config.
 * Shared with the main process's makeResolveSession so readiness and the live
 * session agree on "which provider".
 */
export function resolveActiveProviderConfigId(
  settings: Pick<AppSettings, "active_provider_config_id">,
  configs: readonly Pick<ProviderConfig, "config_id" | "is_default" | "capability">[],
): string | null {
  const omniConfigs = configs.filter((c) => c.capability === "omni");
  const explicit = settings.active_provider_config_id;
  if (explicit !== null) {
    return omniConfigs.some((c) => c.config_id === explicit) ? explicit : null;
  }
  return omniConfigs.find((c) => c.is_default)?.config_id ?? null;
}

/**
 * Resolve a capability slot (engine spec §6): the explicitly selected config
 * must exist AND carry the matching capability — strict, with NO default-flag
 * fallback for slots. A null/dangling/wrong-capability selection resolves to
 * null and surfaces as `missing_provider`.
 */
export function resolveActiveCapabilityConfigId(
  selectedId: string | null,
  capability: Capability,
  configs: readonly Pick<ProviderConfig, "config_id" | "capability">[],
): string | null {
  if (selectedId === null) return null;
  const config = configs.find((c) => c.config_id === selectedId);
  return config !== undefined && config.capability === capability ? selectedId : null;
}

/**
 * Resolve the current mode. Explicit `current_mode_id` wins (when it exists);
 * otherwise the canonical default mode. No arbitrary first-mode fallback — a
 * dangling current_mode_id surfaces as `missing_mode`.
 */
export function resolveCurrentModeId(
  settings: Pick<AppSettings, "current_mode_id">,
  modes: readonly Pick<Mode, "id">[],
): string | null {
  const explicit = settings.current_mode_id;
  if (explicit !== null) {
    return modes.some((m) => m.id === explicit) ? explicit : null;
  }
  return modes.some((m) => m.id === DEFAULT_MODE_ID) ? DEFAULT_MODE_ID : null;
}

/**
 * Whether a permission pane should raise a readiness blocker. A pane blocks
 * unless it is granted OR its status is "unknown". "unknown" is an INDETERMINATE
 * state — the native query failed, the pane is a platform placeholder (the
 * Windows microphone stub returned it verbatim), or the OS reported a code we
 * don't recognise (e.g. a future AVFoundation enum maps to -1 on macOS). None of
 * those are a user-actionable denial, and treating "unknown" as one is the
 * Windows-mic permanent-false-blocker bug. A definite negative (denied /
 * restricted / not_determined) or a missing row still blocks (conservative:
 * never claim a permission we cannot prove is held). The carve-out is applied to
 * BOTH panes (microphone + accessibility) on purpose; accessibility yields a
 * definite granted/denied on every supported platform today, so it is latent
 * there — locked by a test so the breadth stays an intentional decision.
 */
function permissionBlocks(permissions: readonly ReadinessPermission[], pane: string): boolean {
  const status = permissions.find((p) => p.pane === pane);
  if (status?.granted === true) return false;
  if (status?.status === "unknown") return false;
  return true;
}

/**
 * Derive readiness from the assembled inputs, collecting every independent
 * blocker (so Home can show all fixes at once) rather than short-circuiting on
 * the first.
 */
export function deriveReadiness(input: ReadinessInput): AppReadiness {
  const blockers: AppReadinessBlocker[] = [];

  // Native bridge underpins the hotkey hook + text injection; without it the
  // hotkey-driven dictation flow cannot run at all.
  if (!input.nativeRuntimeAvailable) {
    blockers.push({ kind: "native_runtime_unavailable" });
  }

  // Engine resolution mirrors makeResolveSession exactly. Under asr_llm BOTH
  // slots must resolve to capability-matching configs because the LLM polish hop
  // is unconditional; the ready providerConfigId then carries the ASR config id
  // (the recognition source, mirroring HistoryRecord.provider_id semantics —
  // impl-log decision 4).
  let providerConfigId: string | null = null;
  if (input.settings.engine_mode === "asr_llm") {
    const asrId = resolveActiveCapabilityConfigId(
      input.settings.active_asr_config_id,
      "asr",
      input.providerConfigs,
    );
    const llmId = resolveActiveCapabilityConfigId(
      input.settings.active_llm_config_id,
      "llm",
      input.providerConfigs,
    );
    if (asrId === null || llmId === null) {
      blockers.push({ kind: "missing_provider" });
    } else {
      for (const id of [asrId, llmId]) {
        const config = input.providerConfigs.find((c) => c.config_id === id);
        if (
          config !== undefined &&
          !VERIFIED_STATUSES.has(config.validation.last_validated_status)
        ) {
          blockers.push({ kind: "provider_unverified", configId: id });
        }
      }
      providerConfigId = asrId; // recognition source (impl-log decision 4)
    }
  } else {
    providerConfigId = resolveActiveProviderConfigId(input.settings, input.providerConfigs);
    if (providerConfigId === null) {
      blockers.push({ kind: "missing_provider" });
    } else {
      const config = input.providerConfigs.find((c) => c.config_id === providerConfigId);
      if (config !== undefined && !VERIFIED_STATUSES.has(config.validation.last_validated_status)) {
        blockers.push({ kind: "provider_unverified", configId: providerConfigId });
      }
    }
  }

  const currentModeId = resolveCurrentModeId(input.settings, input.modes);
  if (currentModeId === null) {
    blockers.push({ kind: "missing_mode" });
  } else {
    const mode = input.modes.find((m) => m.id === currentModeId);
    if (mode !== undefined && mode.hotkey === null) {
      blockers.push({ kind: "missing_hotkey", modeId: currentModeId });
    }
  }

  if (permissionBlocks(input.permissions, "microphone")) {
    blockers.push({ kind: "microphone_permission_denied" });
  }
  if (permissionBlocks(input.permissions, "accessibility")) {
    blockers.push({ kind: "accessibility_permission_denied" });
  }

  if (blockers.length === 0 && providerConfigId !== null && currentModeId !== null) {
    return { state: "ready", currentModeId, providerConfigId };
  }
  return { state: "blocked", blockers };
}
