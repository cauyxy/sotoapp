// 模型 — the provider-config library (engine spec §7.1). A responsive card grid
// of saved configs (name / capability / model / status / last-verified), plus a
// two-step in-place add flow:
// step 1 picks a vendor tile, step 2 is the ModelConfigForm (vendor fixed). The
// EngineBoard at the top owns mode/slot wiring; Settings no longer has an engine panel.

import { useMemo, useState } from "react";

import type { Capability, ProviderConfig, SupportedProvider } from "@soto/core";

import { useT } from "../../i18n/context";
import { mutateAppSettings, useAppModel, useAppResources } from "../../store/appResources";
import {
  confirmDialog,
  deleteProviderConfig,
  saveProviderConfig,
  testProviderConfig,
} from "../../ipc";
import { toast } from "../../shared/ui/feedback/toast";
import { PageHeader } from "../../shared/ui/primitives/PageHeader";
import { StatusBadge } from "../../shared/ui/primitives/StatusBadge";
import { Button } from "../../shared/ui/primitives/Button";
import { Menu } from "../../shared/ui/primitives/Menu";
import { Select, type SelectOption } from "../../shared/ui/primitives/Select";
import { EngineBoard } from "./EngineBoard";
import { deriveValidationBadge } from "./engineValidationBadge";
import { ModelConfigForm } from "./ModelConfigForm";
import {
  CAPABILITY_META,
  createConfigDraft,
  draftFromConfig,
  engineModeUsesCapability,
  initialCapabilityForVendor,
  isModelSwitchable,
  modelChips,
  prettifyModelId,
  resolveCockpitWiring,
  saveRequestFromDraft,
  slotKeyForCapability,
  VENDOR_META,
  vendorTiles,
  type ModelConfigDraft,
} from "./modelsDraft";
import { CapabilityIcon, VendorAvatar } from "./modelVisuals";

const CUSTOM_MODEL_VALUE = "__soto_custom_model__";

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

// Compact relative-age label for the "last verified" column (small local helper —
// Plan A left no shared relativeTime util). Falls back to an em dash when a
// config has never been verified.
function relativeAge(t: ReturnType<typeof useT>, at: bigint | null): string {
  if (at == null) return "—";
  const deltaMs = Date.now() - Number(at);
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return t("models.verifiedAge.now");
  if (minutes < 60) return t("models.verifiedAge.minutes", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("models.verifiedAge.hours", { n: hours });
  const days = Math.floor(hours / 24);
  return t("models.verifiedAge.days", { n: days });
}

type AddStep =
  | { kind: "closed" }
  | { kind: "vendor"; capability: Capability | null }
  | {
      kind: "form";
      vendor: SupportedProvider;
      capabilityOptions: Capability[];
      draft: ModelConfigDraft;
      editing: boolean;
    };

export function ModelsPage(): JSX.Element {
  const t = useT();
  const model = useAppModel();
  const resources = useAppResources();

  const configs = model?.providerConfigs ?? [];
  const catalog = useMemo<SupportedProvider[]>(() => model?.providerCatalog ?? [], [model]);
  const tiles = useMemo(() => vendorTiles(catalog), [catalog]);
  const wiring = useMemo(
    () =>
      model !== null
        ? resolveCockpitWiring(model.settings, configs)
        : { omni: null, asr: null, llm: null },
    [model, configs],
  );
  const engineMode = model?.settings.engine_mode ?? "omni";

  const [addStep, setAddStep] = useState<AddStep>({ kind: "closed" });
  // Configs whose badge the user invalidated locally (model/endpoint edit, or an
  // in-flight re-verify) — shown as "not verified" until the next refresh lands.
  const [reverifying, setReverifying] = useState<Set<string>>(new Set());
  const [optimisticModels, setOptimisticModels] = useState<Map<string, string>>(new Map());

  function labelForVendor(vendor: SupportedProvider): string {
    const meta = VENDOR_META[vendor.group ?? vendor.provider_id];
    return meta !== undefined ? t(meta.labelKey) : vendor.display_name;
  }

  function openVendorPicker(capability: Capability | null): void {
    setAddStep({ kind: "vendor", capability });
  }

  function pickVendor(vendor: SupportedProvider, capability: Capability | null): void {
    const options = (["omni", "asr", "llm"] as const).filter(
      (cap) => vendor.capabilities[cap] !== undefined,
    );
    const seedCapability = initialCapabilityForVendor(vendor, capability);
    setAddStep({
      kind: "form",
      vendor,
      capabilityOptions: options,
      draft: createConfigDraft(vendor, seedCapability),
      editing: false,
    });
  }

  function editConfig(config: ProviderConfig): void {
    const vendor = catalog.find((p) => p.provider_id === config.provider_id);
    if (!vendor) {
      toast(t("settings.engine.slot.catalogLoadFailed"));
      return;
    }
    const options = (["omni", "asr", "llm"] as const).filter(
      (cap) => vendor.capabilities[cap] !== undefined,
    );
    setAddStep({
      kind: "form",
      vendor,
      capabilityOptions: options,
      draft: draftFromConfig(config),
      editing: true,
    });
  }

  function closeAddFlow(): void {
    setAddStep({ kind: "closed" });
  }

  async function reverify(config: ProviderConfig): Promise<void> {
    setReverifying((cur) => new Set(cur).add(config.config_id));
    try {
      await testProviderConfig(config.config_id, null);
      await resources.refresh("provider");
    } catch (error) {
      console.error("models: re-verify failed", error);
      toast(t("settings.engine.slot.toastSaveFailed", { note: String(error) }));
    } finally {
      setReverifying((cur) => {
        const next = new Set(cur);
        next.delete(config.config_id);
        return next;
      });
    }
  }

  async function switchModel(config: ProviderConfig, nextModel: string): Promise<void> {
    if (nextModel === config.model) return;

    setReverifying((cur) => new Set(cur).add(config.config_id));
    setOptimisticModels((cur) => new Map(cur).set(config.config_id, nextModel));

    let saved = false;
    try {
      const savedConfig = await saveProviderConfig(
        saveRequestFromDraft({ ...draftFromConfig(config), model: nextModel }),
      );
      saved = true;
      await testProviderConfig(savedConfig.config_id, null);
      await resources.refresh("provider");
    } catch (error) {
      console.error("models: model switch failed", error);
      toast(t("settings.engine.slot.toastSaveFailed", { note: String(error) }));
      if (saved) {
        await resources.refresh("provider");
      }
    } finally {
      setReverifying((cur) => {
        const next = new Set(cur);
        next.delete(config.config_id);
        return next;
      });
      setOptimisticModels((cur) => {
        const next = new Map(cur);
        next.delete(config.config_id);
        return next;
      });
    }
  }

  async function removeConfig(config: ProviderConfig): Promise<void> {
    const inUse = Object.values(wiring).includes(config.config_id);
    const ok = await confirmDialog({
      message: t("models.delete.confirm"),
      detail: inUse ? t("models.delete.detailActive") : t("models.delete.detail"),
      confirmLabel: t("models.deleteAction"),
      cancelLabel: t("models.cancel"),
    });
    if (!ok) return;
    try {
      await deleteProviderConfig(config.config_id);
      await resources.refresh("provider");
    } catch (error) {
      console.error("models: delete failed", error);
      toast(t("settings.engine.slot.toastSaveFailed", { note: String(error) }));
    }
  }

  async function setActive(config: ProviderConfig): Promise<void> {
    try {
      await mutateAppSettings(resources, {
        [slotKeyForCapability(config.capability)]: config.config_id,
      });
    } catch (error) {
      console.error("models: set active failed", error);
      toast(t("settings.engine.saveFailed"));
    }
  }

  return (
    <section className="page models-page">
      <PageHeader title={t("models.title")} />
      {model !== null ? (
        <EngineBoard
          settings={model.settings}
          configs={configs}
          onAddForCapability={openVendorPicker}
          onFocusConfig={(id) =>
            document
              .getElementById(`model-card-${id}`)
              ?.scrollIntoView({
                behavior: prefersReducedMotion() ? "auto" : "smooth",
                block: "nearest",
              })
          }
        />
      ) : null}
      <section className="models-library" aria-label={t("models.title")}>
        {configs.length === 0 ? (
          <div className="empty">{t("models.empty")}</div>
        ) : (
          <div className="models-grid" aria-label={t("models.title")}>
            {configs.map((config) => {
              const localUnverified = reverifying.has(config.config_id);
              const badge = deriveValidationBadge(
                localUnverified ? undefined : config.validation,
                t,
              );
              const verifiedAt = localUnverified ? null : config.validation.last_validated_at;
              const vendor = catalog.find((p) => p.provider_id === config.provider_id);
              const vendorKey = vendor?.group ?? config.provider_id;
              const vendorMeta =
                VENDOR_META[vendorKey] ?? {
                  labelKey: "",
                  monogram: config.provider_id.slice(0, 2).toUpperCase(),
                  sourceKey: "",
                };
              const vendorDisplayLabel =
                vendor !== undefined
                  ? labelForVendor(vendor)
                  : vendorMeta.labelKey.length > 0
                    ? t(vendorMeta.labelKey)
                    : config.provider_id;
              const title = config.display_name ?? vendorDisplayLabel;
              const currentModel = optimisticModels.get(config.config_id) ?? config.model;
              const switchable = isModelSwitchable(catalog, config);
              const modelOptions: SelectOption[] = switchable
                ? [
                    ...modelChips(
                      catalog,
                      config.provider_id,
                      config.capability,
                      currentModel,
                    ).map((modelId) => ({
                      value: modelId,
                      label: prettifyModelId(modelId),
                    })),
                    { value: CUSTOM_MODEL_VALUE, label: t("models.custom") },
                  ]
                : [];
              const capabilityMeta = CAPABILITY_META[config.capability];
              const used = engineModeUsesCapability(engineMode, config.capability);
              const active = used && wiring[config.capability] === config.config_id;
              const slotLabel = t(`settings.engine.slot.${config.capability}`);
              return (
                <article
                  id={`model-card-${config.config_id}`}
                  className={`model-config-card${active ? " is-active" : ""}`}
                  key={config.config_id}
                >
                  <header className="model-card-head">
                    <VendorAvatar
                      monogram={vendorMeta.monogram}
                      providerKey={vendorKey}
                    />
                    <div className="model-card-title-wrap">
                      <h2 className="model-card-title">{title}</h2>
                      <span className="model-card-vendor">
                        {vendorMeta.sourceKey.length > 0
                          ? t(vendorMeta.sourceKey)
                          : vendorDisplayLabel}
                      </span>
                    </div>
                    <Menu
                      label={t("models.actions")}
                      className="model-card-actions"
                      items={[
                        {
                          id: "reverify",
                          label: t("models.reverify"),
                          disabled: localUnverified,
                          onSelect: () => void reverify(config),
                        },
                        {
                          id: "edit",
                          label: t("models.edit"),
                          onSelect: () => editConfig(config),
                        },
                        {
                          id: "delete",
                          label: t("models.deleteAction"),
                          danger: true,
                          onSelect: () => void removeConfig(config),
                        },
                      ]}
                    />
                  </header>

                  <div className="model-card-body">
                    <div className="model-card-tags">
                      <span className="capability-tag">
                        <CapabilityIcon icon={capabilityMeta.icon} />
                        {t(capabilityMeta.labelKey)}
                      </span>
                    </div>
                    <div className="model-activate-row">
                      {!used ? (
                        <span className="model-dormant-hint">{t("models.dormant")}</span>
                      ) : active ? (
                        <span className="model-in-use-pill">
                          {t("models.inUseSlot", { slot: slotLabel })}
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="model-activate-btn"
                          onClick={() => void setActive(config)}
                        >
                          {t("models.setActive", { slot: slotLabel })}
                        </button>
                      )}
                    </div>

                    <div className="model-card-model">
                      <span className="model-card-field-label">{t("models.col.model")}</span>
                      {switchable ? (
                        <Select
                          value={currentModel}
                          options={modelOptions}
                          disabled={localUnverified}
                          className="model-card-model-select"
                          aria-label={t("models.selectModel")}
                          onChange={(value) => {
                            if (value === CUSTOM_MODEL_VALUE) {
                              editConfig(config);
                              return;
                            }
                            void switchModel(config, value);
                          }}
                        />
                      ) : (
                        <code className="model-card-model-static">
                          {prettifyModelId(currentModel)}
                        </code>
                      )}
                    </div>
                  </div>

                  <footer className="model-card-foot">
                    <StatusBadge tone={badge.kind} title={badge.tooltip || undefined}>
                      {badge.text}
                    </StatusBadge>
                    <span className="models-verified-age">{relativeAge(t, verifiedAt)}</span>
                    {badge.kind !== "ok" ? (
                      <button
                        type="button"
                        className="model-inline-action"
                        disabled={localUnverified}
                        title={localUnverified ? t("models.reverifyPending") : undefined}
                        onClick={() => void reverify(config)}
                      >
                        {t("models.verifyNow")}
                      </button>
                    ) : null}
                  </footer>
                </article>
              );
            })}
          </div>
        )}

        {addStep.kind === "closed" ? (
          <div className="models-add-row">
            <Button variant="primary" onClick={() => openVendorPicker(null)}>
              {t("models.add")}
            </Button>
          </div>
        ) : null}

        <div className={`models-add-morph${addStep.kind !== "closed" ? " is-open" : ""}`}>
          {addStep.kind === "vendor" ? (
            <div
              className="models-add-card"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeAddFlow();
                }
              }}
            >
              <div className="models-add-title">{t("models.addStepVendor")}</div>
              <div className="models-vendor-grid">
                {tiles.map((tile) => {
                  const vendor = catalog.find((p) => p.provider_id === tile.provider_id)!;
                  return (
                    <button
                      key={tile.provider_id}
                      type="button"
                      className="models-vendor-tile"
                      onClick={() => pickVendor(vendor, addStep.capability)}
                    >
                      <span className="models-vendor-head">
                        <VendorAvatar
                          monogram={tile.monogram}
                          providerKey={tile.key}
                        />
                        <span className="models-vendor-name">
                          {tile.labelKey !== null ? t(tile.labelKey) : tile.display_name}
                        </span>
                      </span>
                      <span className="models-vendor-caps">
                        {tile.capabilities.map((cap) => (
                          <span key={cap} className="capability-tag capability-tag-small">
                            <CapabilityIcon icon={CAPABILITY_META[cap].icon} />
                            {t(CAPABILITY_META[cap].labelKey)}
                          </span>
                        ))}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="models-add-foot">
                <Button variant="ghost" onClick={closeAddFlow}>
                  {t("models.cancel")}
                </Button>
              </div>
            </div>
          ) : null}

          {addStep.kind === "form" ? (
            <div className="models-add-card">
              <div className="models-add-title">{labelForVendor(addStep.vendor)}</div>
              <ModelConfigForm
                vendor={addStep.vendor}
                catalog={catalog}
                capabilityOptions={addStep.capabilityOptions}
                initialDraft={addStep.draft}
                editing={addStep.editing}
                onCancel={closeAddFlow}
                onSaved={closeAddFlow}
              />
            </div>
          ) : null}
        </div>
      </section>
    </section>
  );
}
