import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./ModesPage.svelte", import.meta.url), "utf8");
const ipcSource = readFileSync(new URL("./modes.ipc.ts", import.meta.url), "utf8");
const autosaveSource = readFileSync(new URL("./modesAutosave.ts", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
const en = readFileSync(new URL("../../i18n/locales/en-US.ts", import.meta.url), "utf8");
const zh = readFileSync(new URL("../../i18n/locales/zh-CN.ts", import.meta.url), "utf8");

function localeSection(locale: string, key: string): string {
  return locale.match(new RegExp(`^  ${key}: \\{[\\s\\S]*?^  \\,`, "m"))?.[0] ?? "";
}

describe("ModesPage redesign surface", () => {
  it("renders the shared PageHeader and page filter pills instead of a custom modes header", () => {
    expect(source).toMatch(/PageHeader/);
    expect(source).not.toMatch(/modeListItem|modes-layout|mode-list/);
    expect(source).not.toMatch(/modes-header|modes-tabs|modes-toolbar/);
    expect(source).toMatch(/PageFilterRow/);
    expect(source).toMatch(/canonicalModeLabel/);
  });

  it("moves trigger and activation controls into the prompt editor top slot", () => {
    expect(source).toMatch(/TriggerEditor/);
    expect(source).toMatch(/PromptEditor/);
    expect(source).toMatch(/topControls/);
    expect(source).not.toMatch(/buildProcessTextRequest|textWorkbenchState/);
    expect(source).not.toMatch(/text-workbench|ModePreview|ModeTryTip/);
  });

  it("does not render the try-a-paragraph demo surface", () => {
    expect(source).not.toMatch(/TrySection|try-section|demoTextForMode/);
    expect(ipcSource).not.toMatch(/modes\.demo|ModeDemoText|demoTextForMode/);
    for (const locale of [en, zh]) {
      expect(locale).not.toMatch(/tryTitle|tryRegenerate|tryRawTag|tryPolishedTag|tryEmpty/);
    }
  });

  it("removes manual save/reset controls and keeps focused edit controls", () => {
    expect(source).not.toMatch(/TranslateLanguagePicker|translateLang/);
    expect(source).not.toMatch(/resetCurrentMode/);
    expect(source).not.toMatch(/restoreDefault|saveBtn/);
    expect(source).toMatch(/hotkey_style/);
    expect(source).not.toMatch(/conflictPolicy|selection_behavior|short_text_skip_chars/);
    expect(source).not.toMatch(/modeProviderSelectValue|applyModeProviderSelection/);
  });

  it("keeps translate language selection in the prompt instead of a separate picker", () => {
    expect(source).not.toMatch(/TranslateLanguagePicker|isTranslateMode/);
    for (const locale of [en, zh]) {
      expect(locale).not.toMatch(/translateLanguage|translateLangZh|translateLangEn/);
    }
  });

  it("debounces autosave and flushes pending edits before mode changes", () => {
    expect(autosaveSource).toMatch(/AUTOSAVE_DELAY_MS\s*=\s*500/);
    expect(source).toMatch(/createAutosaveController/);
    expect(source).toMatch(/flushAll/);
    expect(source).toMatch(/saveCurrentMode/);
    expect(source).toMatch(/saveCurrentPrompt/);
  });

  it("steals conflicting hotkey bindings during autosave", () => {
    expect(source).toMatch(/buildSaveModeRequest\(original, snapshotDraft, "steal"\)/);
    expect(source).not.toMatch(/buildSaveModeRequest\(original, snapshotDraft, "reject"\)/);
  });

  it("surfaces autosave success via the global toast host", () => {
    expect(source).toMatch(/from "..\/..\/shared\/ui\/toast"/);
    expect(source).toMatch(/toast\(translate\("modes\.savedToast"\)\)/);
    for (const locale of [en, zh]) {
      expect(locale).toMatch(/savedToast/);
    }
  });

  it("removes the legacy save/reset locale keys", () => {
    for (const locale of [en, zh]) {
      const modes = localeSection(locale, "modes");
      expect(modes).not.toMatch(/restoreDefault/);
      expect(modes).not.toMatch(/saveBtn/);
    }
  });

  it("renders no inline status messages on the page", () => {
    expect(source).not.toMatch(/status-note|engine-message/);
    expect(source).not.toMatch(/setMessage|t\("modes\.msg/);
  });

  it("keeps the prompt input tall enough for longer prompt editing", () => {
    expect(styles).toMatch(/\.prompt-editor-body\s*\{[\s\S]*min-height:\s*280px;/);
  });
});
