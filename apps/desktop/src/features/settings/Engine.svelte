<script lang="ts">
  import { onMount } from "svelte";

  import {
    createProviderDraft,
    createNewProviderDraft,
    findProviderMeta,
    listProviderConfigs,
    saveProviderConfig as persistProviderConfig,
    saveProviderConfigRequestFromDraft,
    testProviderConfig,
    type ProviderConfigDraft,
    type ProviderCatalog,
    type ProviderConfig
  } from "../../ipc/providers";
  import ProvSlot from "./ProvSlot.svelte";
  import {
    recommendedModelsFor,
    updateDraftProvider,
    validateModelInput
  } from "./providerModel";
  import { catalogStore } from "./providerCatalog";
  import { createProviderVerify, type VerifyResult } from "./providerVerify";
  import { t } from "../../i18n";
  import { toast } from "../../shared/ui/toast";

  const API_KEY_PLACEHOLDER_DOTS = "••••••••••••";

  let draft = $state<ProviderConfigDraft>(createNewProviderDraft(true));
  let draftDirty = false;
  let catalog = $state<ProviderCatalog | null>(null);
  let latestConfig = $state<ProviderConfig | null>(null);
  let modelMenuOpen = $state(false);
  let modelError = $state("");

  const endpointPlaceholder = $derived(
    catalog
      ? findProviderMeta(catalog, draft.provider_id)?.default_endpoint ?? ""
      : ""
  );
  const providerModels = $derived(recommendedModelsFor(catalog, draft.provider_id, draft.model));
  const apiKeyPlaceholder = $derived(
    draft.config_id !== null && draft.api_key === ""
      ? API_KEY_PLACEHOLDER_DOTS
      : $t("settings.engine.slot.apiKeyPlaceholder")
  );

  const validationBadge = $derived.by(() => {
    const validation = latestConfig?.validation;
    if (!validation || validation.last_validated_status === "unspecified" || validation.last_validated_status === "warn") {
      return {
        kind: "warn",
        text: $t("settings.engine.slot.badgeUnverified"),
        tooltip: ""
      };
    }

    if (validation.last_validated_status === "ok") {
      return {
        kind: "ok",
        text: $t("settings.engine.slot.badgeVerified", {
          ms: validation.last_validated_latency_ms ?? 0
        }),
        tooltip: validation.last_validated_at
          ? $t("settings.engine.slot.badgeVerifiedAt", {
              when: new Date(validation.last_validated_at).toLocaleString()
            })
          : ""
      };
    }

    return {
      kind: "err",
      text: $t("settings.engine.slot.badgeFailed"),
      tooltip: validation.last_validated_note ?? ""
    };
  });

  const { state: verifyState, verify } = createProviderVerify<ProviderConfigDraft>({
    getDraft: () => draft,
    setDraft: (next) => {
      draft = next;
      draftDirty = false;
    },
    save: (next) => persistProviderConfig(saveProviderConfigRequestFromDraft(next)),
    test: (configId) => testProviderConfig({ config_id: configId, sample: "Soto provider validation." }),
    errorContext: "settings/engine: provider verify failed"
  });

  function stampVerificationState(
    result: Extract<VerifyResult, { kind: "ok" } | { kind: "verify_failed" }>
  ) {
    const stamped = {
      ...result.saved.validation,
      last_validated_at: new Date().toISOString(),
      last_validated_latency_ms: result.latency_ms,
      last_validated_note: result.note,
      last_validated_status: result.kind === "ok" ? "ok" : "err"
    } as ProviderConfig["validation"];
    latestConfig = { ...result.saved, validation: stamped };
  }

  function markValidationUnverified(saved: ProviderConfig | null) {
    if (!saved) return;
    latestConfig = {
      ...saved,
      validation: {
        ...saved.validation,
        last_validated_at: null,
        last_validated_latency_ms: null,
        last_validated_status: "unspecified",
        last_validated_note: null
      }
    };
  }

  async function saveCurrentProviderConfig() {
    const modelValidation = validateModelInput(draft.model);
    if (!modelValidation.ok) {
      modelError = $t("settings.engine.slot.modelRequired");
      toast(modelError);
      return;
    }

    const result = await verify();
    switch (result.kind) {
      case "ok":
        stampVerificationState(result);
        toast($t("settings.engine.slot.toastSavedOk", { ms: result.latency_ms }));
        break;
      case "verify_failed":
        stampVerificationState(result);
        toast($t("settings.engine.slot.toastSavedVerifyFailed", { note: result.note }));
        break;
      case "timed_out":
        markValidationUnverified(result.saved);
        toast($t("settings.engine.slot.toastSavedVerifyTimedOut"));
        break;
      case "save_failed":
        toast($t("settings.engine.slot.toastSaveFailed", { note: result.note }));
        break;
    }
  }

  async function loadCurrentConfig() {
    try {
      const configs = await listProviderConfigs();
      const current = configs.find((config) => config.is_default) ?? null;
      const supportedCurrent = current && isSupportedProvider(current.provider_id) ? current : null;

      if (!draftDirty) {
        if (supportedCurrent) {
          draft = createProviderDraft(supportedCurrent);
          latestConfig = supportedCurrent;
        } else {
          draft = createNewProviderDraft(true);
          latestConfig = null;
        }
      }
    } catch (error) {
      console.error("settings/engine: failed to load provider config", error);
    }
  }

  onMount(() => {
    const unsubscribe = catalogStore.value.subscribe((value) => {
      catalog = value;
      if (!draftDirty && catalog && !isSupportedProvider(draft.provider_id)) {
        draft = createNewProviderDraft(true);
        latestConfig = null;
      }
    });
    void loadCurrentConfig();
    void catalogStore.ensure().catch((error) => {
      console.error("settings/engine: catalog load failed", error);
      toast($t("settings.engine.slot.catalogLoadFailed"));
    });
    return unsubscribe;
  });

  function updateDraft(patch: Partial<ProviderConfigDraft>) {
    draftDirty = true;
    markValidationUnverified(latestConfig);
    draft = { ...draft, ...patch };
  }

  function isSupportedProvider(providerId: string): boolean {
    if (catalog) return findProviderMeta(catalog, providerId) !== null;
    return providerId.trim().toLowerCase() !== "openai";
  }

  function updateProvider(providerId: string) {
    draftDirty = true;
    modelError = "";
    modelMenuOpen = false;
    markValidationUnverified(latestConfig);
    draft = updateDraftProvider(draft, catalog, providerId);
  }

  function updateModel(model: string) {
    modelError = "";
    updateDraft({ model });
  }

  function selectRecommendedModel(model: string) {
    updateModel(model);
    modelMenuOpen = false;
  }

</script>

{#snippet statusBadge()}
  <span class={`prov-slot-badge ${validationBadge.kind}`} title={validationBadge.tooltip || undefined}>
    {validationBadge.text}
  </span>
{/snippet}

{#snippet providerBody()}
  <div class="prov-slot-form">
    <label><span>{$t("settings.engine.slot.provider")}</span>
      <select value={draft.provider_id} onchange={(e) => updateProvider((e.target as HTMLSelectElement).value)}>
        {#if catalog}
          {#each catalog.providers as provider (provider.provider_id)}
            <option value={provider.provider_id}>{provider.display_name}</option>
          {/each}
        {:else}
          <option value={draft.provider_id}>{draft.provider_id}</option>
        {/if}
      </select>
    </label>
    <label><span>{$t("settings.engine.slot.model")}</span>
      <div class="prov-slot-model-wrap">
        <div class="prov-slot-model-row">
          <input
            role="combobox"
            aria-expanded={modelMenuOpen}
            aria-controls="provider-model-options"
            aria-invalid={modelError ? "true" : undefined}
            aria-describedby={modelError ? "provider-model-error" : undefined}
            spellcheck="false"
            autocapitalize="none"
            autocomplete="off"
            value={draft.model}
            oninput={(e) => updateModel((e.target as HTMLInputElement).value)}
            onkeydown={(e) => {
              if (e.key === "Escape") modelMenuOpen = false;
            }}
          />
          <button
            type="button"
            class="button-icon prov-slot-model-menu-button"
            aria-label={$t("settings.engine.slot.modelRecommendations")}
            aria-expanded={modelMenuOpen}
            onclick={() => {
              modelMenuOpen = !modelMenuOpen;
            }}
          >
            v
          </button>
        </div>
        {#if modelMenuOpen && providerModels.length > 0}
          <div id="provider-model-options" class="prov-slot-model-menu" role="listbox">
            {#each providerModels as model (model)}
              <button
                type="button"
                role="option"
                aria-selected={model === draft.model}
                onclick={() => selectRecommendedModel(model)}
              >
                {model}
              </button>
            {/each}
          </div>
        {/if}
        {#if modelError}
          <span id="provider-model-error" class="prov-slot-model-error">{modelError}</span>
        {/if}
      </div>
    </label>
    <label><span>{$t("settings.engine.slot.apiKey")}</span>
      <input
        type="password"
        value={draft.api_key}
        oninput={(e) => updateDraft({ api_key: (e.target as HTMLInputElement).value })}
        placeholder={apiKeyPlaceholder}
      />
    </label>
    <label><span>{$t("settings.engine.slot.endpoint")}</span>
      <input value={draft.base_url} oninput={(e) => updateDraft({ base_url: (e.target as HTMLInputElement).value })} placeholder={endpointPlaceholder || $t("settings.engine.slot.endpointPlaceholder")} />
    </label>
  </div>
  <div class="prov-slot-foot-actions">
    <button
      type="button"
      class="button-primary"
      onclick={() => void saveCurrentProviderConfig()}
      disabled={$verifyState.kind === "running"}
    >
      {$verifyState.kind === "running" ? $t("settings.engine.slot.savingBtn") : $t("settings.engine.slot.saveBtn")}
    </button>
  </div>
{/snippet}

  <div class="engine">
  <ProvSlot label={$t("settings.engine.slot.omni")} active={true} headerRight={statusBadge}>
    {@render providerBody()}
  </ProvSlot>
</div>
