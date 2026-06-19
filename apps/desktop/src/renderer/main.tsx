// Main-window entrypoint (React port of the old Svelte main.ts). Mounts the
// app shell, wires the i18n provider, and applies the global design system. The
// capsule window has its own entry (features/capsule/capsule.tsx / capsule.html).

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import { I18nProvider } from "./i18n/context";
import { applyThemeAttribute, useAppStore } from "./store/appStore";
import "./styles/index.css";

// Apply best-guess theme before mount so the first frame doesn't flash between
// system-default and the user's actual preference (was bootstrap.applyCached
// Chrome). The store seeds `theme` from the soto.cache.theme localStorage key.
applyThemeAttribute(useAppStore.getState().theme);

// Suppress the context menu except inside editable controls (parity with the
// old main.ts) so the app feels native rather than web-page-y.
document.addEventListener("contextmenu", (event) => {
  const target = event.target as HTMLElement | null;
  if (target?.matches("input, textarea, [contenteditable]")) return;
  event.preventDefault();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);
