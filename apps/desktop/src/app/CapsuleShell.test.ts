import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const mainSource = readFileSync(resolve(process.cwd(), "src/main.ts"), "utf8");
const capsuleEntrySource = readFileSync(
  resolve(process.cwd(), "src/capsuleEntry.ts"),
  "utf8"
);
const capsuleHtml = readFileSync(resolve(process.cwd(), "capsule.html"), "utf8");
const stylesSource = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
const capsuleShellSource = readFileSync(
  resolve(process.cwd(), "src/app/CapsuleShell.svelte"),
  "utf8"
);
const tauriConfig = JSON.parse(
  readFileSync(resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf8")
) as { app?: { windows?: Array<{ label?: string; url?: string }> } };
const tauriMacConfig = JSON.parse(
  readFileSync(resolve(process.cwd(), "src-tauri/tauri.macos.conf.json"), "utf8")
) as { app?: { windows?: Array<{ label?: string; url?: string }> } };
const viteConfig = readFileSync(resolve(process.cwd(), "vite.config.ts"), "utf8");

describe("capsule window surface", () => {
  it("ships the capsule webview from its own HTML entry, not a hash route off main", () => {
    expect(capsuleHtml).toContain('<script type="module" src="/src/capsuleEntry.ts">');
    expect(viteConfig).toMatch(/main:\s*"index\.html"/);
    expect(viteConfig).toMatch(/capsule:\s*"capsule\.html"/);
    expect(capsuleEntrySource).toContain('mount(CapsuleShell,');
    expect(capsuleEntrySource).toContain('document.body.classList.add("capsule-window")');
    expect(mainSource).not.toContain("isCapsuleWindow");
    expect(mainSource).not.toContain("#/capsule");
    expect(mainSource).toContain("mount(App,");
  });

  it("points both Tauri capsule-window entries at capsule.html, not the hashed main entry", () => {
    const capsuleWindow = tauriConfig.app?.windows?.find((w) => w.label === "capsule");
    const macCapsuleWindow = tauriMacConfig.app?.windows?.find((w) => w.label === "capsule");
    expect(capsuleWindow?.url).toBe("capsule.html");
    expect(macCapsuleWindow?.url).toBe("capsule.html");
  });

  it("removes the global page wash from the transparent capsule window", () => {
    const rule = cssRule("body.capsule-window");

    expect(rule).toContain("background: transparent;");
    expect(rule).toContain("background-image: none;");
    expect(rule).toContain("overflow: hidden;");
  });

  it("uses the visual-only VoiceCapsuleOverlay rather than the old control pill", () => {
    expect(capsuleShellSource).toContain('from "../shared/ui/VoiceCapsuleOverlay.svelte"');
    expect(capsuleShellSource).toContain("<VoiceCapsuleOverlay");
    expect(capsuleShellSource).not.toContain("../shared/ui/Waveform");
    expect(capsuleShellSource).not.toContain("finishActiveVoiceRuntime");
    expect(capsuleShellSource).not.toContain("capsule-circle");
    expect(capsuleShellSource).toContain("capsule.aria.");
    expect(capsuleShellSource).toContain("capsule.error.missingProvider");
    expect(capsuleShellSource).toContain("capsule.error.generic");
    expect(capsuleShellSource).toContain("levels={waveLevels}");
  });

  it("cancels the active runtime when Escape is observed", () => {
    expect(capsuleShellSource).toContain("keydown");
    expect(capsuleShellSource).toContain('"Escape"');
    expect(capsuleShellSource).toContain("cancelActiveVoiceRuntime");
  });
});

function cssRule(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = stylesSource.match(new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`, "m"));
  return match?.groups?.body ?? "";
}
