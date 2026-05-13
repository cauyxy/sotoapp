import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./PromptEditor.svelte", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

describe("PromptEditor controls", () => {
  it("exposes a topControls slot between the header and textarea", () => {
    expect(source).toMatch(/topControls\?:\s*Snippet/);
    expect(source).toMatch(/prompt-editor-top-controls/);

    const headIndex = source.indexOf("prompt-editor-head");
    const controlsIndex = source.indexOf("prompt-editor-top-controls");
    const textareaIndex = source.indexOf("prompt-editor-body");
    expect(headIndex).toBeGreaterThan(-1);
    expect(controlsIndex).toBeGreaterThan(headIndex);
    expect(textareaIndex).toBeGreaterThan(controlsIndex);
  });

  it("keeps prompt text upright inside the textarea", () => {
    const bodyBlock = styles.match(/\.prompt-editor-body\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(bodyBlock).toContain("font-style: normal;");
    expect(bodyBlock).not.toContain("font-style: italic;");
  });
});
