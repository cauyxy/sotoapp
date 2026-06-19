import type { ReactNode } from "react";

import { SettingIcon, type SettingIconName } from "./SettingIcon";

// One settings row: leading icon tile + label/description stack + a fixed-width
// control column (the control is passed as children). The control column width
// is governed by --soto-setting-control-w so every row aligns to one right edge.
export function SettingRow({
  icon,
  label,
  desc,
  children,
}: {
  icon: SettingIconName;
  label: string;
  desc?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="setting-row">
      <span className="setting-row-tile" aria-hidden="true">
        <SettingIcon name={icon} />
      </span>
      <div className="setting-row-text">
        <span className="setting-row-label">{label}</span>
        {desc !== undefined && desc !== "" ? (
          <span className="setting-row-desc">{desc}</span>
        ) : null}
      </div>
      <div className="setting-row-control">{children}</div>
    </div>
  );
}
