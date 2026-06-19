import { describe, expect, it } from "vitest";

import type { Mode, ProviderConfig } from "../../contract/schema.js";
import {
  deriveReadiness,
  resolveActiveCapabilityConfigId,
  resolveActiveProviderConfigId,
  resolveCurrentModeId,
  type ReadinessInput,
} from "./readiness.js";

function providerConfig(over: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    config_id: "cfg-1",
    provider_id: "openai",
    display_name: null,
    model: "whisper-1",
    base_url: null,
    is_default: true,
    capability: "omni",
    validation: {
      last_validated_at: 1n,
      last_validated_latency_ms: 10,
      last_validated_status: "ok",
      last_validated_note: null,
      last_validated_sample: null,
      last_validated_sample_result: null,
    },
    created_at: 0n,
    updated_at: 0n,
    ...over,
  };
}

function mode(over: Partial<Mode> = {}): Mode {
  return {
    id: "default",
    name: "Default",
    prompt_body: "",
    hotkey: { chord: "LeftMeta" },
    display_order: 0,
    built_in: true,
    created_at: 0n,
    updated_at: 0n,
    ...over,
  };
}

function settings(
  over: Partial<ReadinessInput["settings"]> = {},
): ReadinessInput["settings"] {
  return {
    active_provider_config_id: "cfg-1",
    current_mode_id: "default",
    engine_mode: "omni",
    active_asr_config_id: null,
    active_llm_config_id: null,
    ...over,
  };
}

function readyInput(over: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    settings: settings(),
    modes: [mode()],
    providerConfigs: [providerConfig()],
    permissions: [
      { pane: "microphone", granted: true },
      { pane: "accessibility", granted: true },
    ],
    nativeRuntimeAvailable: true,
    ...over,
  };
}

describe("deriveReadiness", () => {
  it("reports ready with the resolved mode + provider when fully configured", () => {
    expect(deriveReadiness(readyInput())).toEqual({
      state: "ready",
      currentModeId: "default",
      providerConfigId: "cfg-1",
    });
  });

  it("blocks with missing_provider when there are no provider configs", () => {
    const readiness = deriveReadiness(
      readyInput({ providerConfigs: [], settings: settings({ active_provider_config_id: null }) }),
    );
    expect(readiness.state).toBe("blocked");
    if (readiness.state !== "blocked") throw new Error("unreachable");
    expect(readiness.blockers).toContainEqual({ kind: "missing_provider" });
  });

  it("blocks (does NOT auto-pick) when active_provider_config_id points at a missing config", () => {
    const readiness = deriveReadiness(
      readyInput({
        settings: settings({ active_provider_config_id: "ghost" }),
        providerConfigs: [providerConfig({ config_id: "cfg-1", is_default: false })],
      }),
    );
    expect(readiness.state).toBe("blocked");
    if (readiness.state !== "blocked") throw new Error("unreachable");
    expect(readiness.blockers).toContainEqual({ kind: "missing_provider" });
  });

  it("blocks with provider_unverified when the active config was never validated", () => {
    const readiness = deriveReadiness(
      readyInput({
        providerConfigs: [
          providerConfig({ validation: { ...providerConfig().validation, last_validated_status: "unspecified" } }),
        ],
      }),
    );
    expect(readiness.state).toBe("blocked");
    if (readiness.state !== "blocked") throw new Error("unreachable");
    expect(readiness.blockers).toContainEqual({ kind: "provider_unverified", configId: "cfg-1" });
  });

  it("blocks with provider_unverified when validation last failed", () => {
    const readiness = deriveReadiness(
      readyInput({
        providerConfigs: [
          providerConfig({ validation: { ...providerConfig().validation, last_validated_status: "err" } }),
        ],
      }),
    );
    if (readiness.state !== "blocked") throw new Error("expected blocked");
    expect(readiness.blockers).toContainEqual({ kind: "provider_unverified", configId: "cfg-1" });
  });

  it("treats a warn validation as verified-enough (not a blocker)", () => {
    const readiness = deriveReadiness(
      readyInput({
        providerConfigs: [
          providerConfig({ validation: { ...providerConfig().validation, last_validated_status: "warn" } }),
        ],
      }),
    );
    expect(readiness.state).toBe("ready");
  });

  it("blocks with missing_mode when current_mode_id points at a missing mode", () => {
    const readiness = deriveReadiness(
      readyInput({ settings: settings({ current_mode_id: "ghost" }) }),
    );
    if (readiness.state !== "blocked") throw new Error("expected blocked");
    expect(readiness.blockers).toContainEqual({ kind: "missing_mode" });
  });

  it("blocks with missing_mode when there are no modes at all", () => {
    const readiness = deriveReadiness(
      readyInput({ modes: [], settings: settings({ current_mode_id: null }) }),
    );
    if (readiness.state !== "blocked") throw new Error("expected blocked");
    expect(readiness.blockers).toContainEqual({ kind: "missing_mode" });
  });

  it("blocks with missing_hotkey when the current mode has no hotkey bound", () => {
    const readiness = deriveReadiness(readyInput({ modes: [mode({ hotkey: null })] }));
    if (readiness.state !== "blocked") throw new Error("expected blocked");
    expect(readiness.blockers).toContainEqual({ kind: "missing_hotkey", modeId: "default" });
  });

  it("blocks with microphone_permission_denied when mic permission is not granted", () => {
    const readiness = deriveReadiness(
      readyInput({
        permissions: [
          { pane: "microphone", granted: false },
          { pane: "accessibility", granted: true },
        ],
      }),
    );
    if (readiness.state !== "blocked") throw new Error("expected blocked");
    expect(readiness.blockers).toContainEqual({ kind: "microphone_permission_denied" });
  });

  it("does NOT block on an 'unknown' microphone status (failed/stubbed query is not a denial)", () => {
    const readiness = deriveReadiness(
      readyInput({
        permissions: [
          { pane: "microphone", granted: false, status: "unknown" },
          { pane: "accessibility", granted: true, status: "granted" },
        ],
      }),
    );
    expect(readiness.state).toBe("ready");
  });

  it("blocks with accessibility_permission_denied when accessibility is not granted", () => {
    const readiness = deriveReadiness(
      readyInput({
        permissions: [
          { pane: "microphone", granted: true },
          { pane: "accessibility", granted: false },
        ],
      }),
    );
    if (readiness.state !== "blocked") throw new Error("expected blocked");
    expect(readiness.blockers).toContainEqual({ kind: "accessibility_permission_denied" });
  });

  it("does NOT block on an 'unknown' accessibility status (carve-out is intentional for both panes)", () => {
    const readiness = deriveReadiness(
      readyInput({
        permissions: [
          { pane: "microphone", granted: true, status: "granted" },
          { pane: "accessibility", granted: false, status: "unknown" },
        ],
      }),
    );
    expect(readiness.state).toBe("ready");
  });

  it("blocks with native_runtime_unavailable when the native bridge is absent", () => {
    const readiness = deriveReadiness(readyInput({ nativeRuntimeAvailable: false }));
    if (readiness.state !== "blocked") throw new Error("expected blocked");
    expect(readiness.blockers).toContainEqual({ kind: "native_runtime_unavailable" });
  });

  it("collects every independent blocker at once", () => {
    const readiness = deriveReadiness({
      settings: settings({ active_provider_config_id: null, current_mode_id: null }),
      modes: [],
      providerConfigs: [],
      permissions: [
        { pane: "microphone", granted: false },
        { pane: "accessibility", granted: false },
      ],
      nativeRuntimeAvailable: false,
    });
    if (readiness.state !== "blocked") throw new Error("expected blocked");
    expect(readiness.blockers).toEqual(
      expect.arrayContaining([
        { kind: "native_runtime_unavailable" },
        { kind: "missing_provider" },
        { kind: "missing_mode" },
        { kind: "microphone_permission_denied" },
        { kind: "accessibility_permission_denied" },
      ]),
    );
  });
});

describe("deriveReadiness under asr_llm (strict two-slot resolution)", () => {
  const asrConfig = providerConfig({ config_id: "asr-1", capability: "asr", is_default: false });
  const llmConfig = providerConfig({ config_id: "llm-1", capability: "llm", is_default: false });

  function asrLlmInput(over: Partial<ReadinessInput> = {}): ReadinessInput {
    return readyInput({
      settings: settings({
        engine_mode: "asr_llm",
        active_provider_config_id: null,
        active_asr_config_id: "asr-1",
        active_llm_config_id: "llm-1",
      }),
      providerConfigs: [asrConfig, llmConfig],
      ...over,
    });
  }

  it("is ready with both slots resolved; providerConfigId carries the ASR config id", () => {
    expect(deriveReadiness(asrLlmInput())).toEqual({
      state: "ready",
      currentModeId: "default",
      providerConfigId: "asr-1",
    });
  });

  it("blocks with missing_provider when only the asr slot is selected", () => {
    const readiness = deriveReadiness(
      asrLlmInput({
        settings: settings({
          engine_mode: "asr_llm",
          active_provider_config_id: null,
          active_asr_config_id: "asr-1",
          active_llm_config_id: null,
        }),
      }),
    );
    if (readiness.state !== "blocked") throw new Error("expected blocked");
    expect(readiness.blockers).toContainEqual({ kind: "missing_provider" });
  });

  it("blocks with missing_provider when a slot points at a config with the WRONG capability", () => {
    const readiness = deriveReadiness(
      asrLlmInput({
        settings: settings({
          engine_mode: "asr_llm",
          active_provider_config_id: null,
          active_asr_config_id: "llm-1", // llm capability in the asr slot
          active_llm_config_id: "llm-1",
        }),
      }),
    );
    if (readiness.state !== "blocked") throw new Error("expected blocked");
    expect(readiness.blockers).toContainEqual({ kind: "missing_provider" });
  });

  it("blocks with provider_unverified naming the asr config when it is unverified", () => {
    const unverifiedAsr = providerConfig({
      config_id: "asr-1",
      capability: "asr",
      is_default: false,
      validation: { ...providerConfig().validation, last_validated_status: "unspecified" },
    });
    const readiness = deriveReadiness(asrLlmInput({ providerConfigs: [unverifiedAsr, llmConfig] }));
    if (readiness.state !== "blocked") throw new Error("expected blocked");
    expect(readiness.blockers).toContainEqual({ kind: "provider_unverified", configId: "asr-1" });
  });

  it("blocks with provider_unverified naming the llm config when it is unverified", () => {
    const unverifiedLlm = providerConfig({
      config_id: "llm-1",
      capability: "llm",
      is_default: false,
      validation: { ...providerConfig().validation, last_validated_status: "err" },
    });
    const readiness = deriveReadiness(asrLlmInput({ providerConfigs: [asrConfig, unverifiedLlm] }));
    if (readiness.state !== "blocked") throw new Error("expected blocked");
    expect(readiness.blockers).toContainEqual({ kind: "provider_unverified", configId: "llm-1" });
  });
});

describe("resolveActiveCapabilityConfigId (engine slots, no default-flag fallback)", () => {
  const cfgs = [
    providerConfig({ config_id: "asr-1", capability: "asr", is_default: true }),
    providerConfig({ config_id: "llm-1", capability: "llm", is_default: false }),
  ];

  it("returns an explicit selection that exists and matches the capability", () => {
    expect(resolveActiveCapabilityConfigId("asr-1", "asr", cfgs)).toBe("asr-1");
  });

  it("returns null when nothing is selected — even with a default-flagged matching config", () => {
    expect(resolveActiveCapabilityConfigId(null, "asr", cfgs)).toBeNull();
  });

  it("returns null for a dangling selection", () => {
    expect(resolveActiveCapabilityConfigId("ghost", "asr", cfgs)).toBeNull();
  });

  it("returns null when the selected config carries the wrong capability", () => {
    expect(resolveActiveCapabilityConfigId("llm-1", "asr", cfgs)).toBeNull();
  });
});

describe("resolveActiveProviderConfigId (shared with makeResolveSession)", () => {
  const cfgs = [
    providerConfig({ config_id: "a", is_default: false }),
    providerConfig({ config_id: "b", is_default: true }),
  ];

  it("returns an explicit, valid active id", () => {
    expect(resolveActiveProviderConfigId({ active_provider_config_id: "a" }, cfgs)).toBe("a");
  });

  it("returns null for an explicit id that no longer exists (no auto-pick)", () => {
    expect(resolveActiveProviderConfigId({ active_provider_config_id: "ghost" }, cfgs)).toBeNull();
  });

  it("falls back to the default-flagged config when none is explicitly active", () => {
    expect(resolveActiveProviderConfigId({ active_provider_config_id: null }, cfgs)).toBe("b");
  });

  it("returns null (never the arbitrary first) when no explicit and no default", () => {
    const noDefault = [
      providerConfig({ config_id: "a", is_default: false }),
      providerConfig({ config_id: "c", is_default: false }),
    ];
    expect(resolveActiveProviderConfigId({ active_provider_config_id: null }, noDefault)).toBeNull();
  });

  it("only considers omni-capability configs: an explicit non-omni id resolves to null", () => {
    const mixed = [
      providerConfig({ config_id: "asr-1", capability: "asr", is_default: false }),
      ...cfgs,
    ];
    expect(resolveActiveProviderConfigId({ active_provider_config_id: "asr-1" }, mixed)).toBeNull();
  });

  it("the default-flag fallback never lands on an asr/llm config", () => {
    const onlyNonOmniDefault = [
      providerConfig({ config_id: "asr-1", capability: "asr", is_default: true }),
      providerConfig({ config_id: "a", capability: "omni", is_default: false }),
    ];
    expect(
      resolveActiveProviderConfigId({ active_provider_config_id: null }, onlyNonOmniDefault),
    ).toBeNull();
  });
});

describe("resolveCurrentModeId", () => {
  const modes = [mode({ id: "default" }), mode({ id: "translate", hotkey: null })];

  it("returns an explicit, valid current mode id", () => {
    expect(resolveCurrentModeId({ current_mode_id: "translate" }, modes)).toBe("translate");
  });

  it("returns null for an explicit id that no longer exists", () => {
    expect(resolveCurrentModeId({ current_mode_id: "ghost" }, modes)).toBeNull();
  });

  it("falls back to the default mode when none is explicitly current", () => {
    expect(resolveCurrentModeId({ current_mode_id: null }, modes)).toBe("default");
  });

  it("returns null when no explicit current and no default mode exists", () => {
    expect(resolveCurrentModeId({ current_mode_id: null }, [mode({ id: "translate" })])).toBeNull();
  });
});
