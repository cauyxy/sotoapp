// 模型 add/edit form (engine spec §7.1, step 2 of the add flow). The vendor is
// fixed by the time this renders; the form owns the editable draft and wires the
// shared verify machine (createProviderVerify) exactly as the old Engine panel
// did: 保存并验证 saves the config then runs a "reply ok" / silent-WAV round trip,
// stamps the local badge, and refreshes the AppModel so the list reflects the
// persisted validation stamp (B7).
//
// Pure cascade logic (model menu, credential shape, endpoint requirement, save
// request) lives in modelsDraft.ts; this file is the form layout + verify wiring.

import { useRef, useState } from "react";

import type { Capability, SupportedProvider } from "@soto/core";

import { saveProviderConfig, testProviderConfig } from "../../ipc";
import { mutateAppSettings, useAppModel, useAppResources } from "../../store/appResources";
import { toast } from "../../shared/ui/feedback/toast";
import { useT } from "../../i18n/context";
import { Button } from "../../shared/ui/primitives/Button";
import { CapabilityIcon } from "./modelVisuals";
import {
  createProviderVerify,
  type VerifyResult,
  type VerifyState,
} from "./providerVerify";
import {
  API_KEY_PLACEHOLDER_DOTS,
  CAPABILITY_META,
  consoleUrlForProvider,
  credentialFields,
  endpointRequired,
  engineModeUsesCapability,
  modelChips,
  saveRequestFromDraft,
  slotKeyForCapability,
  type ModelConfigDraft,
} from "./modelsDraft";

export interface ModelConfigFormProps {
  /** The fixed vendor for this draft (step 1 chose it). */
  vendor: SupportedProvider;
  /** Full provider catalog (for the model chips). */
  catalog: readonly SupportedProvider[];
  /** Capabilities the vendor offers, in display order (>1 ⇒ segmented pill). */
  capabilityOptions: Capability[];
  /** Initial draft (createConfigDraft for add, draftFromConfig for edit). */
  initialDraft: ModelConfigDraft;
  /** True in edit mode (api-key placeholder dots, keep-existing-on-blank). */
  editing: boolean;
  onCancel: () => void;
  /** Called after a successful save+verify so the host can close + refresh. */
  onSaved: () => void;
}

export function ModelConfigForm({
  vendor,
  catalog,
  capabilityOptions,
  initialDraft,
  editing,
  onCancel,
  onSaved,
}: ModelConfigFormProps): JSX.Element {
  const t = useT();
  const resources = useAppResources();
  const appModel = useAppModel();

  const [draft, setDraft] = useState<ModelConfigDraft>(initialDraft);
  const [verifyState, setVerifyState] = useState<VerifyState>({ kind: "idle" });
  const [lastResult, setLastResult] = useState<VerifyResult | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  // Keep a ref of the live draft so the verify machine's getDraft() reads the
  // current value (closures otherwise capture the initial draft).
  const draftRef = useRef(draft);
  draftRef.current = draft;

  function patch(next: Partial<ModelConfigDraft>): void {
    setJustSaved(false);
    setLastResult(null);
    setDraft((cur) => ({ ...cur, ...next }));
  }

  // The verify machine is created once and kept in a ref (useRef has no lazy
  // init; build it on first render). save = saveRequestFromDraft round-trip,
  // test = the no-sample capability validation (omni/llm reply-ok, asr silent WAV
  // resolved by main from the config's capability).
  const verifyRef = useRef<{ verify: () => Promise<VerifyResult> } | null>(null);
  const verifyMachine = (verifyRef.current ??= createProviderVerify<ModelConfigDraft>({
    getDraft: () => draftRef.current,
    setDraft: (nextDraft) => setDraft(nextDraft),
    save: (nextDraft) => saveProviderConfig(saveRequestFromDraft(nextDraft)),
    test: (configId) => testProviderConfig(configId, null),
    onState: (state) => setVerifyState(state),
    errorContext: "models/form: provider verify failed",
  }));

  async function saveAndVerify(setActiveAfter = false): Promise<void> {
    if (draftRef.current.model.trim().length === 0) {
      toast(t("settings.engine.slot.modelRequired"));
      return;
    }

    const result = await verifyMachine.verify();
    setLastResult(result);
    switch (result.kind) {
      case "ok":
        setJustSaved(true);
        toast(t("settings.engine.slot.toastSavedOk", { ms: result.latency_ms }));
        break;
      case "verify_failed":
        toast(t("settings.engine.slot.toastSavedVerifyFailed", { note: result.note }));
        break;
      case "timed_out":
        toast(t("settings.engine.slot.toastSavedVerifyTimedOut"));
        break;
      case "save_failed":
        toast(t("settings.engine.slot.toastSaveFailed", { note: result.note }));
        break;
    }
    if (result.kind !== "save_failed") {
      if (setActiveAfter && result.saved !== null) {
        try {
          await mutateAppSettings(resources, {
            [slotKeyForCapability(result.saved.capability)]: result.saved.config_id,
          });
        } catch (error) {
          console.error("models/form: set active failed", error);
          toast(t("settings.engine.saveFailed"));
        }
      }
      // The config was persisted — refresh so the list shows the stamped badge.
      await resources.refresh("provider");
      onSaved();
    }
  }

  const chips = modelChips(catalog, vendor.provider_id, draft.capability, draft.model);
  const creds = credentialFields(vendor.provider_id);
  const consoleUrl = consoleUrlForProvider(vendor.provider_id);
  const endpointOnMain = endpointRequired(vendor.provider_id, vendor.group);
  const apiKeyPlaceholder =
    editing && draft.api_key === "" ? API_KEY_PLACEHOLDER_DOTS : t("settings.engine.slot.apiKeyPlaceholder");
  const progress: "waiting" | "success" | null =
    verifyState.kind === "running" ? "waiting" : justSaved ? "success" : null;
  const engineMode = appModel?.settings.engine_mode ?? "omni";
  const canSetActive = engineModeUsesCapability(engineMode, draft.capability);

  function verifyResultText(result: VerifyResult): string {
    switch (result.kind) {
      case "ok":
        return t("settings.engine.slot.toastSavedOk", { ms: result.latency_ms });
      case "verify_failed":
        return t("settings.engine.slot.toastSavedVerifyFailed", { note: result.note });
      case "timed_out":
        return t("settings.engine.slot.toastSavedVerifyTimedOut");
      case "save_failed":
        return t("settings.engine.slot.toastSaveFailed", { note: result.note });
    }
  }

  function verifyResultTone(result: VerifyResult): "ok" | "warn" | "err" {
    switch (result.kind) {
      case "ok":
        return "ok";
      case "timed_out":
        return "warn";
      case "verify_failed":
      case "save_failed":
        return "err";
    }
  }

  return (
    <div className="model-form">
      {capabilityOptions.length > 1 ? (
        <div
          className="segmented model-form-capability"
          role="radiogroup"
          aria-label={t("models.col.capability")}
        >
          {capabilityOptions.map((cap) => (
            <button
              key={cap}
              type="button"
              role="radio"
              aria-checked={draft.capability === cap}
              className={draft.capability === cap ? "active" : ""}
              onClick={() => {
                const menu = vendor.capabilities[cap];
                patch({ capability: cap, model: menu?.default_model ?? "" });
              }}
            >
              <CapabilityIcon icon={CAPABILITY_META[cap].icon} />
              {t(CAPABILITY_META[cap].labelKey)}
            </button>
          ))}
        </div>
      ) : (
        <span className="capability-tag model-form-capability-tag">
          <CapabilityIcon icon={CAPABILITY_META[draft.capability].icon} />
          {t(CAPABILITY_META[draft.capability].labelKey)}
        </span>
      )}

      <label className="model-form-row">
        <span className="model-form-label">{t("models.col.model")}</span>
        <div className="model-form-chips">
          {chips.map((chip) => (
            <button
              key={chip}
              type="button"
              className={`chip${draft.model === chip ? " chip--on" : ""}`}
              onClick={() => patch({ model: chip })}
            >
              {chip}
            </button>
          ))}
          <input
            className="model-form-custom"
            aria-label={t("models.custom")}
            placeholder={t("models.custom")}
            autoCapitalize="none"
            autoComplete="off"
            value={draft.model}
            onChange={(e) => patch({ model: e.target.value })}
          />
        </div>
      </label>

      {creds === "doubao_pair" ? (
        <>
          <label className="model-form-row">
            <span className="model-form-label">{t("models.appKey")}</span>
            <input
              type="password"
              value={draft.app_key}
              placeholder={apiKeyPlaceholder}
              onChange={(e) => patch({ app_key: e.target.value })}
            />
          </label>
          <label className="model-form-row">
            <span className="model-form-label">{t("models.accessKey")}</span>
            <input
              type="password"
              value={draft.access_key}
              placeholder={apiKeyPlaceholder}
              onChange={(e) => patch({ access_key: e.target.value })}
            />
          </label>
        </>
      ) : (
        <label className="model-form-row">
          <span className="model-form-label">
            {t("models.apiKey")}
            {consoleUrl !== null ? (
              <a
                className="model-form-getkey"
                href={consoleUrl}
                target="_blank"
                rel="noreferrer noopener"
              >
                {t("models.getApiKey")} ↗
              </a>
            ) : null}
          </span>
          <input
            type="password"
            value={draft.api_key}
            placeholder={apiKeyPlaceholder}
            onChange={(e) => patch({ api_key: e.target.value })}
          />
        </label>
      )}

      {endpointOnMain ? (
        <>
          <label className="model-form-row">
            <span className="model-form-label">{t("models.endpoint")}</span>
            <input
              value={draft.base_url}
              placeholder={vendor.default_base_url ?? ""}
              onChange={(e) => patch({ base_url: e.target.value })}
            />
          </label>
        </>
      ) : null}

      <details className="model-form-advanced">
        <summary>{t("models.advanced")}</summary>
        {!endpointOnMain ? (
          <label className="model-form-row">
            <span className="model-form-label">{t("models.endpoint")}</span>
            <input
              value={draft.base_url}
              placeholder={vendor.default_base_url ?? ""}
              onChange={(e) => patch({ base_url: e.target.value })}
            />
          </label>
        ) : null}
        <label className="model-form-row">
          <span className="model-form-label">{t("models.displayName")}</span>
          <input
            value={draft.display_name}
            onChange={(e) => patch({ display_name: e.target.value })}
          />
        </label>
      </details>

      {verifyState.kind === "running" ? (
        <div className="model-form-verify-result" data-tone="running">
          <span className="dot" />
          {t("settings.engine.slot.verifying")}
        </div>
      ) : lastResult !== null ? (
        <div className="model-form-verify-result" data-tone={verifyResultTone(lastResult)}>
          <span className="dot" />
          {verifyResultText(lastResult)}
        </div>
      ) : null}

      <div className="model-form-actions">
        <Button variant="ghost" onClick={onCancel}>
          {t("models.cancel")}
        </Button>
        <Button
          variant={canSetActive ? "ghost" : "primary"}
          onClick={() => void saveAndVerify(false)}
          progress={progress}
          disabled={verifyState.kind === "running"}
        >
          {t("models.saveAndVerify")}
        </Button>
        {canSetActive ? (
          <Button
            variant="primary"
            onClick={() => void saveAndVerify(true)}
            progress={progress}
            disabled={verifyState.kind === "running"}
          >
            {t("models.saveAndSetActive")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
