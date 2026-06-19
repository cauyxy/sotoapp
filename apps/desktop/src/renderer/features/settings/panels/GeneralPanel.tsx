import { mutateAppSettings, useAppModel, useAppResources } from "../../../store/appResources";
import { applyTextScaleAttribute } from "../../../store/appStore";
import type { TextScale } from "../../../store/textScale";
import { useT } from "../../../i18n/context";
import { isMacOS } from "./constants";
import { SettingRow } from "./SettingRow";

const TEXT_SCALE_OPTIONS: TextScale[] = ["small", "default", "large"];

export function GeneralPanel(): JSX.Element {
  const t = useT();
  const model = useAppModel();
  const resources = useAppResources();
  const settings = model?.settings ?? null;
  const on = settings?.hide_app_icon ?? false;
  const includeWindowContext = settings?.include_window_context_in_requests ?? true;
  const launchAtLogin = settings?.launch_at_login ?? true;
  const textScale = settings?.base_text_scale ?? "default";
  const label = t(isMacOS() ? "settings.general.hideIconMac" : "settings.general.hideIconWin");

  async function toggleHideIcon(): Promise<void> {
    if (!settings) return;
    try {
      await mutateAppSettings(resources, { hide_app_icon: !settings.hide_app_icon });
    } catch (error) {
      console.error("settings/general: failed to save", error);
    }
  }

  async function toggleIncludeWindowContext(): Promise<void> {
    if (!settings) return;
    try {
      await mutateAppSettings(resources, {
        include_window_context_in_requests: !settings.include_window_context_in_requests,
      });
    } catch (error) {
      console.error("settings/general: failed to save", error);
    }
  }

  async function toggleLaunchAtLogin(): Promise<void> {
    if (!settings) return;
    try {
      await mutateAppSettings(resources, { launch_at_login: !settings.launch_at_login });
    } catch (error) {
      console.error("settings/general: failed to save", error);
    }
  }

  async function setTextScale(next: TextScale): Promise<void> {
    if (!settings) return;
    const previous = settings.base_text_scale;
    applyTextScaleAttribute(next);
    try {
      await mutateAppSettings(resources, { base_text_scale: next });
    } catch (error) {
      applyTextScaleAttribute(previous);
      console.error("settings/general: failed to save", error);
    }
  }

  return (
    <>
      <SettingRow
        icon="textSize"
        label={t("settings.general.textSize.label")}
        desc={t("settings.general.textSize.desc")}
      >
        <div
          className="segmented"
          role="radiogroup"
          aria-label={t("settings.general.textSize.label")}
        >
          {TEXT_SCALE_OPTIONS.map((scale) => (
            <button
              key={scale}
              type="button"
              role="radio"
              aria-checked={textScale === scale}
              className={textScale === scale ? "active" : ""}
              onClick={() => void setTextScale(scale)}
              disabled={settings === null}
            >
              {t(`settings.general.textSize.${scale}`)}
            </button>
          ))}
        </div>
      </SettingRow>
      <SettingRow icon="dock" label={label} desc={t("settings.general.hideIconDesc")}>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={label}
          title={t("settings.general.hideIconHint")}
          className={`toggle ${on ? "toggle--on" : ""}`}
          onClick={() => void toggleHideIcon()}
          disabled={settings === null}
        >
          <span className="toggle-thumb" />
        </button>
      </SettingRow>
      <SettingRow
        icon="startup"
        label={t("settings.general.launchAtLogin")}
        desc={t("settings.general.launchAtLoginDesc")}
      >
        <button
          type="button"
          role="switch"
          aria-checked={launchAtLogin}
          aria-label={t("settings.general.launchAtLogin")}
          title={t("settings.general.launchAtLoginHint")}
          className={`toggle ${launchAtLogin ? "toggle--on" : ""}`}
          onClick={() => void toggleLaunchAtLogin()}
          disabled={settings === null}
        >
          <span className="toggle-thumb" />
        </button>
      </SettingRow>
      <SettingRow
        icon="privacy"
        label={t("settings.general.includeWindowContext")}
        desc={t("settings.general.includeWindowContextDesc")}
      >
        <button
          type="button"
          role="switch"
          aria-checked={includeWindowContext}
          aria-label={t("settings.general.includeWindowContext")}
          title={t("settings.general.includeWindowContextHint")}
          className={`toggle ${includeWindowContext ? "toggle--on" : ""}`}
          onClick={() => void toggleIncludeWindowContext()}
          disabled={settings === null}
        >
          <span className="toggle-thumb" />
        </button>
      </SettingRow>
    </>
  );
}
