import { useMemo } from "react";

import type { AppSettings, Capability, EngineMode, ProviderConfig } from "@soto/core";

import { useT } from "../../i18n/context";
import { mutateAppSettings, useAppResources } from "../../store/appResources";
import { toast } from "../../shared/ui/feedback/toast";
import {
  CAPABILITY_META,
  prettifyModelId,
  resolveCockpitWiring,
  slotKeyForCapability,
  type CockpitWiring,
} from "./modelsDraft";

const MODE_OPTIONS: readonly EngineMode[] = ["omni", "asr_llm"];
const MODE_CAPABILITIES: Record<EngineMode, readonly Capability[]> = {
  omni: ["omni"],
  asr_llm: ["asr", "llm"],
};

export function EngineBoard({
  settings,
  configs,
  onAddForCapability,
  onFocusConfig,
}: {
  settings: AppSettings;
  configs: readonly ProviderConfig[];
  onAddForCapability: (cap: Capability) => void;
  onFocusConfig: (configId: string) => void;
}): JSX.Element {
  const t = useT();
  const resources = useAppResources();
  const wiring = useMemo(() => resolveCockpitWiring(settings, configs), [settings, configs]);
  const byId = useMemo(
    () => new Map(configs.map((config) => [config.config_id, config])),
    [configs],
  );

  async function saveSettings(patch: Partial<AppSettings>): Promise<void> {
    try {
      await mutateAppSettings(resources, patch);
    } catch (error) {
      console.error("models/engine-board: failed to save", error);
      toast(t("settings.engine.saveFailed"));
    }
  }

  function canClear(capability: Capability, resolvedId: string | null): boolean {
    if (resolvedId === null) return false;
    if (capability !== "omni") return true;
    if (settings.active_provider_config_id === null) return false;
    const fallbackWiring = resolveCockpitWiring(
      { ...settings, active_provider_config_id: null },
      configs,
    );
    return fallbackWiring.omni !== resolvedId;
  }

  function renderSlot(capability: Capability): JSX.Element {
    const resolvedId = wiring[capability as keyof CockpitWiring];
    const config = resolvedId !== null ? byId.get(resolvedId) : undefined;
    const slotLabel = t(`settings.engine.slot.${capability}`);

    if (config === undefined) {
      return (
        <button
          key={capability}
          type="button"
          className="engine-board-slot is-empty"
          onClick={() => onAddForCapability(capability)}
        >
          <span className="engine-board-slot-label">{slotLabel}</span>
          <span className="engine-board-slot-value">{t("models.unassigned")}</span>
        </button>
      );
    }

    const label =
      config.display_name ?? `${config.provider_id} · ${prettifyModelId(config.model)}`;
    const defaultedOmni =
      capability === "omni" &&
      settings.active_provider_config_id === null &&
      resolvedId !== null;
    const showClear = canClear(capability, resolvedId);

    return (
      <div key={capability} className="engine-board-slot">
        <button
          type="button"
          className="engine-board-slot-main"
          onClick={() => onFocusConfig(config.config_id)}
        >
          <span className="engine-board-slot-label">{slotLabel}</span>
          <span className="engine-board-slot-value">{label}</span>
        </button>
        {defaultedOmni ? (
          <span className="engine-board-default-tag">{t("models.default")}</span>
        ) : null}
        {showClear ? (
          <button
            type="button"
            className="engine-board-clear"
            aria-label={t("models.clearSlot")}
            onClick={() =>
              void saveSettings({ [slotKeyForCapability(capability)]: null })
            }
          >
            ×
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <section className="engine-board" aria-label={t("settings.engine.mode.aria")}>
      <div
        className="segmented engine-board-mode"
        role="radiogroup"
        aria-label={t("settings.engine.mode.aria")}
      >
        {MODE_OPTIONS.map((mode) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={settings.engine_mode === mode}
            className={settings.engine_mode === mode ? "active" : ""}
            onClick={() => void saveSettings({ engine_mode: mode })}
          >
            {t(`settings.engine.mode.${mode}`)}
          </button>
        ))}
      </div>

      {configs.length > 0 ? (
        <div className="engine-board-slots">
          {MODE_CAPABILITIES[settings.engine_mode].map((capability) =>
            renderSlot(capability),
          )}
        </div>
      ) : null}
    </section>
  );
}
