import { useEffect, useSyncExternalStore } from "react";

import { useT } from "../../../i18n/context";
import { CloseIcon, IconButton } from "../primitives/IconButton";
import {
  AlertLevel,
  removeAlert,
  startAlertListener,
  subscribeAlerts,
  visibleAlerts,
} from "./alerts";
import "./alertStack.css";

function levelClass(level: AlertLevel): string {
  if (level === AlertLevel.BLOCKING) return "alert-blocking";
  if (level === AlertLevel.PERSISTENT) return "alert-persistent";
  return "alert-temporary";
}

export function AlertStack(): JSX.Element {
  const visible = useSyncExternalStore(subscribeAlerts, visibleAlerts, visibleAlerts);
  const t = useT();

  // Register the (currently no-op) cross-window listener for parity with the
  // old onMount wiring; cleanup runs on unmount.
  useEffect(() => startAlertListener(), []);

  return (
    <div className="alert-stack">
      {visible.map((alert) => (
        <div
          className={`alert ${levelClass(alert.level)}`}
          key={alert.id}
          role={alert.level === AlertLevel.BLOCKING ? "alert" : "status"}
          aria-live={alert.level === AlertLevel.BLOCKING ? "assertive" : "polite"}
          aria-atomic
        >
          <div className="alert-title">{alert.title}</div>
          {alert.body ? <div className="alert-body">{alert.body}</div> : null}
          {alert.action ? (
            <button type="button" onClick={alert.action.handler}>
              {alert.action.label}
            </button>
          ) : null}
          <IconButton
            icon={<CloseIcon />}
            label={t("common.close")}
            className="alert-dismiss"
            size="md"
            onClick={() => removeAlert(alert.id)}
          />
        </div>
      ))}
    </div>
  );
}
