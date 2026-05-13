import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import * as themeModule from "../shared/theme";

const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const sidebarSource = readFileSync(new URL("./Sidebar.svelte", import.meta.url), "utf8");
const navIconSource = readFileSync(new URL("../shared/ui/NavIcon.svelte", import.meta.url), "utf8");
const sotoMarkSource = readFileSync(new URL("../shared/ui/SotoMark.svelte", import.meta.url), "utf8");

describe("sidebar utility row contract", () => {
  it("keeps the utility status visible while long pages scroll independently", () => {
    const shellRule = cssRule(".app-shell");
    const sidebarRule = cssRule(".sidebar");
    const pageRule = cssRule(".page");

    expect(shellRule).toContain("height: 100vh;");
    expect(shellRule).toContain("grid-template-rows: minmax(0, 1fr);");
    expect(shellRule).toContain("overflow: hidden;");
    expect(sidebarRule).toContain("height: 100%;");
    expect(sidebarRule).toContain("min-height: 0;");
    expect(pageRule).toContain("height: 100%;");
    expect(pageRule).toContain("min-height: 0;");
    expect(pageRule).toContain("overflow: auto;");
    expect(pageRule).toContain("scrollbar-width: none;");
    expect(pageRule).toContain("-ms-overflow-style: none;");
    expect(cssRule(".page::-webkit-scrollbar")).toContain("display: none;");
  });

  it("keeps utility buttons as fixed 28px circles inside the flex row", () => {
    const rule = cssRule(".util-btn");

    expect(rule).toContain("width: 28px;");
    expect(rule).toContain("height: 28px;");
    expect(rule).toContain("min-width: 28px;");
    expect(rule).toContain("flex: 0 0 28px;");
    expect(rule).toContain("aspect-ratio: 1;");
    expect(rule).toContain("border-radius: 50%;");
  });

  it("uses distinct icons for system, light, and dark theme states", () => {
    expect("themeIconName" in themeModule).toBe(true);

    const themeIconName = themeModule.themeIconName as (theme: themeModule.Theme) => string;

    expect(themeIconName("system")).toBe("theme-system");
    expect(themeIconName("light")).toBe("theme-light");
    expect(themeIconName("dark")).toBe("theme-dark");
  });

  it("uses the packaged app icon for the sidebar brand mark", () => {
    expect(sidebarSource).toContain('import SotoMark from "../shared/ui/SotoMark.svelte";');
    expect(sidebarSource).toContain("<SotoMark size={28} />");
    expect(sidebarSource).not.toContain("SotoMarkGlyph");
    expect(sotoMarkSource).toContain("../../../src-tauri/icons/icon.png");
  });

  it("uses the softened redesign active nav treatment", () => {
    const navRule = cssRule(".nav button");
    const activeRule = cssRule(".nav button.active");

    expect(navRule).toContain("border-radius: 8px;");
    expect(activeRule).toContain("background: rgba(26, 29, 34, 0.05);");
    expect(activeRule).toContain("font-weight: 600;");
    expect(activeRule).not.toContain("border-left");
  });

  it("uses a gear icon for Settings", () => {
    expect(navIconSource).toContain('name === "Settings"');
    expect(navIconSource).toContain("M12.22 2h-.44");
    expect(navIconSource).toContain('<circle cx="12" cy="12" r="3" />');
    expect(navIconSource).not.toContain("M12 3.5 V5.6");
  });
});

function cssRule(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = stylesSource.match(new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`, "m"));
  return match?.groups?.body ?? "";
}
