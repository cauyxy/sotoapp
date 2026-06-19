import { describe, expect, it } from "vitest";

import { selectTheme, selectView } from "./appStore";
import { type NavItem } from "../shared/nav";
import { type Theme } from "../shared/theme";

// These exercise only the pure shell selectors (no React renderer). The
// useView / useTheme hooks are thin `useAppStore(selector)` wrappers, so
// covering the selectors covers the read shape. Business data moved out of this
// store into AppResources, so there are no snapshot selectors left to test.

type AppStateArg = Parameters<typeof selectView>[0];

function stateWith(fields: { view?: NavItem; theme?: Theme }): AppStateArg {
  return {
    view: fields.view ?? "Home",
    theme: fields.theme ?? "system",
  } as AppStateArg;
}

describe("appStore shell selectors", () => {
  it("selectView / selectTheme read the flat chrome fields", () => {
    const s = stateWith({ view: "History", theme: "dark" });
    expect(selectView(s)).toBe("History");
    expect(selectTheme(s)).toBe("dark");
  });
});
