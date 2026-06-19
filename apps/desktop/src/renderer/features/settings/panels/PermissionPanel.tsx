import { useCallback, useEffect, useState } from "react";

import {
  isAccessibilityTrusted,
  listPermissionStatuses,
  onPermissionUpdated,
  openPermissionSettings,
  requestAccessibilityPermission,
  requestPermissionAuthorization,
  type PermissionStatus,
  type PermissionPane,
} from "../../../ipc";
import { toast } from "../../../shared/ui/feedback/toast";
import { useAppModel, useAppResources } from "../../../store/appResources";
import { useT } from "../../../i18n/context";

const PANES = ["microphone", "accessibility"] as const satisfies readonly PermissionPane[];
type VisiblePermissionPane = (typeof PANES)[number];
type VisiblePermissionStatus = Omit<PermissionStatus, "pane"> & { pane: VisiblePermissionPane };

const PANE_LABEL_KEY: Record<
  VisiblePermissionPane,
  { title: string; requestActionTitle: string; settingsActionTitle: string }
> = {
  microphone: {
    title: "onboarding.permissions.microphoneTitle",
    requestActionTitle: "onboarding.permissions.microphoneAction",
    settingsActionTitle: "onboarding.permissions.microphoneSettingsAction",
  },
  accessibility: {
    title: "onboarding.permissions.accessibilityTitle",
    requestActionTitle: "onboarding.permissions.accessibilityAction",
    settingsActionTitle: "onboarding.permissions.accessibilityAction",
  },
};

function MicGlyph(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11 a6.5 6.5 0 0 0 13 0" />
      <path d="M12 17.5 V21" />
      <path d="M8.5 21 H15.5" />
    </svg>
  );
}

function AxGlyph(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="4.5" r="1.7" />
      <path d="M4 9 H20" />
      <path d="M12 8 V13.5" />
      <path d="M8 20.5 L12 13.5 L16 20.5" />
    </svg>
  );
}

function CheckGlyph(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5 L10 17.5 L19 6.5" />
    </svg>
  );
}

function glyphFor(pane: VisiblePermissionPane): () => JSX.Element {
  if (pane === "microphone") return MicGlyph;
  return AxGlyph;
}

function fallbackStatus(pane: VisiblePermissionPane): VisiblePermissionStatus {
  return {
    pane,
    granted: false,
    status: "unknown",
    label: "Unknown",
    detail: "Permission status is unavailable.",
  };
}

function visibleStatus(
  pane: VisiblePermissionPane,
  status: PermissionStatus | undefined,
): VisiblePermissionStatus {
  return status ? { ...status, pane } : fallbackStatus(pane);
}

export function PermissionPanel(): JSX.Element {
  const t = useT();
  const resources = useAppResources();
  const model = useAppModel();
  // Seed from the AppModel's permission snapshot (no "Unknown" flash on mount);
  // the live refresh below re-reads the panes for up-to-the-second state.
  const [rows, setRows] = useState<VisiblePermissionStatus[]>(() => {
    const byPane = new Map((model?.permissions ?? []).map((s) => [s.pane, s]));
    return PANES.map((pane) => visibleStatus(pane, byPane.get(pane)));
  });
  const [openingPane, setOpeningPane] = useState<VisiblePermissionPane | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [statuses, axTrusted] = await Promise.all([
        listPermissionStatuses(),
        isAccessibilityTrusted().catch(() => false),
      ]);
      const byPane = new Map(statuses.map((s) => [s.pane, s]));
      const next: VisiblePermissionStatus[] = PANES.map((pane) => {
        const status = visibleStatus(pane, byPane.get(pane));
        if (pane !== "accessibility" || status.granted || !axTrusted) return status;
        return {
          ...status,
          granted: true,
          status: "granted",
          label: "Ready",
          detail: "Accessibility is trusted.",
        };
      });
      setRows(next);
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : t("onboarding.permissions.msg.unavailable");
      toast(msg);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    return onPermissionUpdated(() => {
      void refresh();
      // Keep the AppModel (and Home readiness) in lock-step with permission flips.
      void resources.refresh("permissions");
    });
  }, [refresh, resources]);

  useEffect(() => {
    const onFocus = (): void => {
      void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  async function requestPane(pane: VisiblePermissionPane): Promise<void> {
    setOpeningPane(pane);
    try {
      if (pane === "accessibility") {
        await requestAccessibilityPermission();
      } else {
        await requestPermissionAuthorization(pane);
      }
      await refresh();
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : t("onboarding.permissions.msg.openFailed");
      toast(msg);
    } finally {
      setOpeningPane(null);
    }
  }

  async function openSettings(pane: VisiblePermissionPane): Promise<void> {
    setOpeningPane(pane);
    try {
      await openPermissionSettings(pane);
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : t("onboarding.permissions.msg.openFailed");
      toast(msg);
    } finally {
      setOpeningPane(null);
    }
  }

  return (
    <div className="permission-strip">
      <div className="permission-panel__head">
        <div className="permission-panel__title">{t("settings.nav.permissions")}</div>
        <button
          type="button"
          className="button button-ghost permission-panel__refresh permission-refresh"
          onClick={() => void refresh()}
        >
          {t("onboarding.permissions.refreshStatus")}
        </button>
      </div>
      <p className="permission-panel__sub">{t("onboarding.permissions.subtitle")}</p>
      <div className="permission-grid">
        {rows.map((row) => {
          const labels = PANE_LABEL_KEY[row.pane];
          const Glyph = glyphFor(row.pane);
          const name = t(labels.title);
          const busy = openingPane === row.pane;
          const request = row.status === "not_determined";
          const action = request
            ? t("onboarding.permissions.action.request")
            : t("onboarding.permissions.action.openSettings");
          const actionTitle = request
            ? t(labels.requestActionTitle)
            : t(labels.settingsActionTitle);
          return (
            <div
              key={row.pane}
              className="permission-card"
              data-state={row.granted ? "ready" : "action"}
              role="group"
              title={row.detail}
              aria-label={`${name}: ${row.label}`}
            >
              <span className="permission-tile" aria-hidden="true">
                <Glyph />
              </span>
              <div className="permission-card__body">
                <div className="permission-card__name">{name}</div>
                <div className="permission-card__status">{row.label}</div>
              </div>
              {row.granted ? (
                <span className="permission-card__check" aria-hidden="true">
                  <CheckGlyph />
                </span>
              ) : (
                <button
                  type="button"
                  className="permission-card__action"
                  disabled={busy}
                  title={busy ? t("onboarding.permissions.openingAction") : `${actionTitle} - ${row.detail}`}
                  onClick={() => void (request ? requestPane(row.pane) : openSettings(row.pane))}
                >
                  {action}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
