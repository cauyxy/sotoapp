import {
  findProviderMeta,
  type ProviderCatalog,
  type ProviderConfigDraft
} from "../../ipc/providers";

export type ModelValidation = { ok: true } | { ok: false; reason: "required" };

export function updateDraftProvider(
  draft: ProviderConfigDraft,
  catalog: ProviderCatalog | null,
  providerId: string
): ProviderConfigDraft {
  const previousDefault = defaultModelFor(catalog, draft.provider_id);
  const nextDefault = defaultModelFor(catalog, providerId);
  const currentModel = draft.model.trim();
  const shouldUseProviderDefault =
    currentModel.length === 0 || (previousDefault !== null && currentModel === previousDefault);

  return {
    ...draft,
    provider_id: providerId,
    base_url: "",
    ...(shouldUseProviderDefault && nextDefault ? { model: nextDefault } : {})
  };
}

export function recommendedModelsFor(
  catalog: ProviderCatalog | null,
  providerId: string,
  currentModel: string
): string[] {
  const suggested = catalog ? findProviderMeta(catalog, providerId)?.suggested_models ?? [] : [];
  const models = [...suggested];
  const custom = currentModel.trim();
  if (custom.length > 0 && !models.includes(custom)) {
    models.push(custom);
  }
  return models;
}

export function validateModelInput(model: string): ModelValidation {
  return model.trim().length > 0 ? { ok: true } : { ok: false, reason: "required" };
}

function defaultModelFor(catalog: ProviderCatalog | null, providerId: string): string | null {
  return catalog ? findProviderMeta(catalog, providerId)?.default_model ?? null : null;
}
