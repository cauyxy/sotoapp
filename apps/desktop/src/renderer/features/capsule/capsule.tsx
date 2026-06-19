// Capsule-window entrypoint. Mounts the always-on-top recording capsule. Kept a
// side-effect-only file (no local component definitions) so Fast Refresh works —
// the component itself lives in ./CapsuleApp (mirrors main.tsx / app/App.tsx).
//
// I18nProvider is required: CapsulePanel renders translated copy via useT(),
// which throws outside the provider. The capsule resolves its locale from the
// per-window shell store (localStorage cache → OS), same as the main window.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { I18nProvider } from "../../i18n/context";
import { CapsuleApp } from "./CapsuleApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <CapsuleApp />
    </I18nProvider>
  </StrictMode>,
);
