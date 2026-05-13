import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./Engine.svelte", import.meta.url), "utf8");

describe("Engine settings surface", () => {
  it("starts with an editable provider draft so config-load failures cannot hide the form", () => {
    expect(source).toMatch(
      /let draft = \$state<ProviderConfigDraft>\(createNewProviderDraft\(true\)\)/
    );
    expect(source).not.toMatch(/let draft = \$state<ProviderConfigDraft \| null>\(null\)/);
  });

  it("renders the provider form through ProvSlot children instead of an explicit children prop", () => {
    expect(source).toMatch(/<ProvSlot[\s\S]*>\s*\{@render providerBody\(\)\}\s*<\/ProvSlot>/);
    expect(source).not.toMatch(/children=\{providerBody\}/);
  });

  it("renames verify action to save and shows saving state", () => {
    expect(source).toMatch(/saveBtn/);
    expect(source).toMatch(/savingBtn/);
    expect(source).toMatch(/button-primary/);
    expect(source).toMatch(/disabled=\{\$verifyState.kind === "running"\}/);
    expect(source).not.toMatch(/verifyBtn/);
    expect(source).not.toMatch(/verifyingBtn/);
  });

  it("uses toast feedback instead of VerifyResult snippet", () => {
    expect(source).toMatch(/toast\(/);
    expect(source).toMatch(/toastSavedOk/);
    expect(source).toMatch(/toastSavedVerifyFailed/);
    expect(source).toMatch(/toastSavedVerifyTimedOut/);
    expect(source).toMatch(/toastSaveFailed/);
    expect(source).not.toMatch(/#snippet\s+VerifyResult|<VerifyResult(?:\s|>|\/)/);
  });

  it("renders validation badge in header and keeps single-column form layout", () => {
    expect(source).toMatch(/statusBadge/);
    expect(source).toMatch(/prov-slot-badge/);
    expect(source).toMatch(/badgeVerified/);
    expect(source).toMatch(/badgeUnverified/);
    expect(source).toMatch(/badgeFailed/);
    expect(source).toMatch(/prov-slot-form/);
    expect(source).not.toMatch(/prov-slot-form-wide/);
    expect(source).toMatch(/prov-slot-foot-actions/);
  });

  it("adds API key saved placeholder when editing persisted config", () => {
    expect(source).toMatch(/API_KEY_PLACEHOLDER_DOTS/);
    expect(source).toMatch(/apiKeyPlaceholder/);
  });

  it("renders model as an editable combobox with recommended options", () => {
    expect(source).toMatch(/recommendedModelsFor/);
    expect(source).toMatch(/validateModelInput/);
    expect(source).toMatch(/role="combobox"/);
    expect(source).toMatch(/spellcheck="false"/);
    expect(source).toMatch(/autocapitalize="none"/);
    expect(source).toMatch(/prov-slot-model-menu/);
    expect(source).not.toMatch(/<select value=\{draft\.model\}/);
  });

  it("validates blank model input locally before save", () => {
    expect(source).toMatch(/modelRequired/);
    expect(source).toMatch(/validateModelInput\(draft\.model\)/);
  });
});
