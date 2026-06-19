import { lazy, Suspense, useEffect, useRef } from "react";

import { Sidebar } from "../shared/ui/layout/Sidebar";
import { AlertStack } from "../shared/ui/feedback/AlertStack";
import { ToastHost } from "../shared/ui/feedback/ToastHost";
import { POPOVER_VIEW_CHANGE_EVENT } from "../shared/ui/primitives/Menu";
import { SotoMark } from "../shared/ui/primitives/SotoMark";
import { HomePage } from "../features/home/HomePage";
import { DictionaryPage } from "../features/dictionary/DictionaryPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import {
  confirmDialog,
  hasBridge,
  onMenuAction,
  repairData,
  windowPlatform,
} from "../ipc";
import { type NavItem } from "../shared/nav";
import { useT } from "../i18n/context";
import {
  applyThemeAttribute,
  reconcileChromeFromSettings,
  useAppStore,
  useTheme,
  useView,
} from "../store/appStore";
import { AppResourcesProvider, useAppModelState } from "../store/appResources";

const HistoryPage = lazy(() =>
  import("../features/history/HistoryPage").then((m) => ({ default: m.HistoryPage })),
);
const ModesPage = lazy(() =>
  import("../features/modes/ModesPage").then((m) => ({ default: m.ModesPage })),
);
const ModelsPage = lazy(() =>
  import("../features/models/ModelsPage").then((m) => ({ default: m.ModelsPage })),
);

// Render-once-visited panes, kept mounted and toggled via [hidden] — mirrors the
// old App.svelte `visited` Set so a page keeps its scroll/state after the first
// visit but isn't paid for until the user navigates there.
function useVisited(active: NavItem): Set<NavItem> {
  // Lazy-init the seed Set so it isn't reallocated and thrown away every render
  // (react-doctor/rerender-lazy-ref-init); the `??=` result is the non-null Set.
  const visitedRef = useRef<Set<NavItem> | null>(null);
  const visited = (visitedRef.current ??= new Set<NavItem>(["Home"]));
  if (visited.has(active)) return visited;
  const next = new Set(visited).add(active);
  visitedRef.current = next;
  return next;
}

function AppShell(): JSX.Element {
  const t = useT();
  const active = useView();
  const theme = useTheme();
  const setView = useAppStore((s) => s.setView);
  const modelState = useAppModelState();

  const visited = useVisited(active);

  useEffect(() => {
    window.dispatchEvent(new Event(POPOVER_VIEW_CHANGE_EVENT));
  }, [active]);

  // Apply the persisted theme to <html data-theme> on mount + whenever it
  // changes (the single CSS theming hook — was Sidebar.svelte's $effect).
  useEffect(() => {
    applyThemeAttribute(theme);
  }, [theme]);

  useEffect(() => {
    if (!hasBridge()) return;
    const platform = windowPlatform();
    document.documentElement.setAttribute("data-platform", platform);
    // Windows runs an opaque window backing (no mica), so flip the renderer to
    // the solid window wash — there is no translucent backing to show through.
    // See windows.ts (windowsBackdropColor) for why mica is off on Windows.
    if (platform === "win32") {
      document.documentElement.setAttribute("data-window-surface", "opaque");
    }
  }, []);

  // Reconcile chrome (theme/locale) from the persisted settings the first time
  // the AppModel becomes ready — DB settings win over the optimistic cache
  // (parity with the old bootstrap reconciliation).
  const reconciledRef = useRef(false);
  useEffect(() => {
    if (!reconciledRef.current && modelState.status === "ready") {
      reconciledRef.current = true;
      reconcileChromeFromSettings(modelState.model.settings);
    }
  }, [modelState]);

  useEffect(() => {
    if (!hasBridge()) return;
    return onMenuAction((payload) => {
      if (typeof payload !== "object" || payload === null) return;
      const kind = (payload as { kind?: unknown }).kind;
      if (kind === "preferences") {
        setView("Settings");
      } else if (kind === "models") {
        setView("Models");
      }
    });
  }, [setView]);

  if (modelState.status === "loading") {
    return (
      <main className="onboarding-shell">
        <SotoMark />
        <div className="status-note">{t("onboarding.launch.loading")}</div>
      </main>
    );
  }

  // Bridge missing (preload failed) or the initial get_app_model failed: surface
  // it explicitly rather than rendering an empty shell over absent data.
  if (modelState.status !== "ready") {
    // `error` means the bridge is alive but get_app_model failed (corrupt db /
    // unreadable secrets) — the recoverable case, so offer data repair. `unavailable`
    // means the preload bridge is missing, where no IPC (and thus no repair) is possible.
    const canRepair = modelState.status === "error";
    return (
      <main className="onboarding-shell">
        <SotoMark />
        <div className="status-note">{t("onboarding.launch.unavailable")}</div>
        {canRepair ? (
          <button
            type="button"
            className="status-action"
            onClick={() => {
              void (async () => {
                const ok = await confirmDialog({
                  message: t("onboarding.launch.repairConfirm"),
                  detail: t("onboarding.launch.repairConfirmDetail"),
                  confirmLabel: t("onboarding.launch.repairConfirmAction"),
                });
                if (ok) await repairData();
              })();
            }}
          >
            {t("onboarding.launch.repairData")}
          </button>
        ) : null}
        <ToastHost />
      </main>
    );
  }

  return (
    <>
      <div className="app-shell">
        <div className="window-drag-region" aria-hidden="true" />
        <Sidebar />
        <main className="app-shell-content">
          {visited.has("Home") ? (
            <div className="app-shell-pane" hidden={active !== "Home"}>
              <HomePage />
            </div>
          ) : null}
          {visited.has("History") ? (
            <div className="app-shell-pane" hidden={active !== "History"}>
              <Suspense fallback={null}>
                <HistoryPage />
              </Suspense>
            </div>
          ) : null}
          {visited.has("Dictionary") ? (
            <div className="app-shell-pane" hidden={active !== "Dictionary"}>
              <DictionaryPage />
            </div>
          ) : null}
          {visited.has("Modes") ? (
            <div className="app-shell-pane" hidden={active !== "Modes"}>
              <Suspense fallback={null}>
                <ModesPage />
              </Suspense>
            </div>
          ) : null}
          {visited.has("Models") ? (
            <div className="app-shell-pane" hidden={active !== "Models"}>
              <Suspense fallback={null}>
                <ModelsPage />
              </Suspense>
            </div>
          ) : null}
          {visited.has("Settings") ? (
            <div className="app-shell-pane" hidden={active !== "Settings"}>
              <SettingsPage />
            </div>
          ) : null}
        </main>
      </div>
      <div id="overlay-root" className="app-overlay-root" />
      <AlertStack />
      <ToastHost />
    </>
  );
}

export function App(): JSX.Element {
  return (
    <AppResourcesProvider>
      <AppShell />
    </AppResourcesProvider>
  );
}
