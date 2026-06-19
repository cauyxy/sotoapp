import { useMemo } from "react";

import type { AppReadinessBlocker, HistoryRecord, Mode } from "@soto/core";

import { type NavItem } from "../../shared/nav";
import { todayOverview } from "./model";
import { useT } from "../../i18n/context";
import { useAppStore } from "../../store/appStore";
import { useAppModel } from "../../store/appResources";
import { modeTone } from "../../shared/modeTone";
import { prettyChord as chordDisplayLabel } from "../../shared/chordDisplay";
import { Button } from "../../shared/ui/primitives/Button";
import { SignalDot } from "../../shared/ui/primitives/SignalDot";

const BLOCKER_FIX: Record<AppReadinessBlocker["kind"], NavItem> = {
  missing_provider: "Models",
  provider_unverified: "Models",
  missing_mode: "Modes",
  missing_hotkey: "Modes",
  microphone_permission_denied: "Settings",
  accessibility_permission_denied: "Settings",
  native_runtime_unavailable: "Settings",
};

function relativeTime(t: ReturnType<typeof useT>, now: number, at: bigint): string {
  const mins = Math.max(0, Math.floor((now - Number(at)) / 60_000));
  if (mins < 1) return t("home.recentRow.justNow");
  if (mins < 60) return t("home.recentRow.minutesAgo", { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("home.recentRow.hoursAgo", { count: hours });
  return t("home.recentRow.daysAgo", { count: Math.floor(hours / 24) });
}

export function HomePage(): JSX.Element {
  const t = useT();
  const setView = useAppStore((s) => s.setView);
  const model = useAppModel();
  const now = Date.now();

  const history = useMemo(() => model?.recentHistory ?? [], [model]);
  const today = useMemo(() => todayOverview(history, now), [history, now]);
  const recents = useMemo(() => history.slice(0, 6), [history]);

  const readiness = model?.readiness ?? null;
  const ready = readiness?.state === "ready";
  const blockers = readiness?.state === "blocked" ? readiness.blockers : [];

  const modes = model?.modes ?? [];
  const currentMode = modes.find((m) => m.id === model?.activeModeId) ?? null;
  const chord = currentMode?.hotkey?.chord ?? null;

  const modeOf = (record: HistoryRecord): Mode | null =>
    modes.find((m) => m.id === record.mode_id) ?? null;

  return (
    <section className="page home-page">
      <div className="home-status-row">
        <SignalDot tone={ready ? "ok" : "warn"} breathe={ready} />
        <span className="home-status-text">
          {ready ? (
            chord ? (
              <>
                <span>{t("home.gesture.hold")}</span>
                {" "}
                <kbd className="hotkey-badge">{chordDisplayLabel(chord)}</kbd>
                {" "}
                <span>{t("home.gesture.speak")}</span>
              </>
            ) : (
              t("home.gesture.noHotkey")
            )
          ) : (
            t("home.readiness.needsAttention")
          )}
        </span>
      </div>

      <section className="home-stats" aria-label={t("home.stats.aria")}>
        <div className="home-stat">
          <span className="home-stat-value">{today.characterCount.toLocaleString()}</span>
          <span className="home-stat-label">{t("home.stats.chars")}</span>
        </div>
        <div className="home-stat">
          <span className="home-stat-value">{today.sessionCount}</span>
          <span className="home-stat-label">{t("home.stats.sessions")}</span>
        </div>
        <div className="home-stat">
          <span className="home-stat-value">{`${today.avgSeconds.toFixed(1)}s`}</span>
          <span className="home-stat-label">{t("home.stats.avg")}</span>
        </div>
      </section>

      {blockers.length > 0 ? (
        <section className="group home-blockers">
          <div className="row-list">
            {blockers.map((blocker) => (
              <div className="row" key={blocker.kind}>
                <SignalDot tone="warn" />
                <span className="row-primary">{t(`home.readiness.blocker.${blocker.kind}`)}</span>
                <span className="row-actions home-blocker-fix">
                  <Button variant="ghost" onClick={() => setView(BLOCKER_FIX[blocker.kind])}>
                    {t("home.readiness.fix")}
                  </Button>
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Recent preview: shared rows in the page flow. */}
      <section className="group recent-card">
        <header className="recent-card-head">
          <span className="recent-card-title">{t("home.recent")}</span>
          {recents.length > 0 ? (
            <button type="button" className="recent-card-view-all" onClick={() => setView("History")}>
              {t("common.viewAll")}
            </button>
          ) : null}
        </header>
        {recents.length === 0 ? (
          <div className="empty">{t("history.empty.title")}</div>
        ) : (
          <div className="row-list">
            {recents.map((record) => (
              <div className="row" key={record.id}>
                <SignalDot tone={modeTone(modeOf(record))} />
                <span className="row-primary">{record.processed_text ?? record.raw_text}</span>
                <span className="row-meta">
                  {record.target_app_name ?? record.target_app ?? t("home.recentRow.unknownApp")}
                  {" · "}
                  {relativeTime(t, now, record.created_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
