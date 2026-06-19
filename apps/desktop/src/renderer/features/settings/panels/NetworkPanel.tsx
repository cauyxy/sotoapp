// Network panel — React port of features/settings/NetworkSettings.svelte.
// A single "use system proxy" switch persisted to AppSettings.use_proxy. Initial
// value comes from the AppModel (no mount-time getAppSettings); the toggle
// persists via a resource mutation that refreshes the model (plan §4.11).

import { mutateAppSettings, useAppModel, useAppResources } from "../../../store/appResources";
import { useT } from "../../../i18n/context";
import { SettingRow } from "./SettingRow";

export function NetworkPanel(): JSX.Element {
  const t = useT();
  const model = useAppModel();
  const resources = useAppResources();
  const settings = model?.settings ?? null;
  // Default OFF to match the persisted default (store seeds use_proxy: false);
  // only matters in the brief window before the model loads (toggle is disabled).
  const on = settings?.use_proxy ?? false;

  async function toggle(): Promise<void> {
    if (!settings) return;
    try {
      await mutateAppSettings(resources, { use_proxy: !settings.use_proxy });
    } catch (error) {
      // The model is unchanged on failure, so the switch reverts on its own.
      console.error("settings/network: failed to save", error);
    }
  }

  return (
    <SettingRow
      icon="proxy"
      label={t("settings.network.useProxy")}
      desc={t("settings.network.useProxyDesc")}
    >
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={t("settings.network.useProxy")}
        title={t("settings.network.useProxyHint")}
        className={`toggle ${on ? "toggle--on" : ""}`}
        onClick={() => void toggle()}
        disabled={settings === null}
      >
        <span className="toggle-thumb" />
      </button>
    </SettingRow>
  );
}
