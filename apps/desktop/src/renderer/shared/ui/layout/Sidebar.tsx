import { NavIcon } from "../primitives/NavIcon";
import { SotoMark } from "../primitives/SotoMark";
import { UtilIcon } from "../primitives/UtilIcon";
import { NAV_LABEL_KEY, type NavItem } from "../../nav";
import { themeIconName } from "../../theme";
import { LOCALE_REGISTRY } from "../../../i18n/types";
import { useT } from "../../../i18n/context";
import { useAppStore, useTheme, useView } from "../../../store/appStore";

const PRIMARY: NavItem[] = ["Home", "History", "Modes", "Dictionary", "Models"];

export function Sidebar(): JSX.Element {
  const t = useT();
  const active = useView();
  const setView = useAppStore((s) => s.setView);
  const theme = useTheme();
  const cycleTheme = useAppStore((s) => s.cycleTheme);
  const locale = useAppStore((s) => s.locale);
  const cycleLocale = useAppStore((s) => s.cycleLocale);
  const localeLabel = locale === "system" ? "System" : LOCALE_REGISTRY[locale].nativeName;

  return (
    <aside className="sidebar">
      <div className="sidebar-mark">
        <SotoMark size={28} />
        <span className="sidebar-wordmark">Soto</span>
      </div>
      <nav className="nav" aria-label="Primary">
        {PRIMARY.map((item) => (
          <button
            key={item}
            type="button"
            className={active === item ? "active" : ""}
            aria-current={active === item ? "page" : undefined}
            onClick={() => setView(item)}
          >
            <NavIcon name={item} />
            <span>{t(NAV_LABEL_KEY[item])}</span>
          </button>
        ))}
      </nav>
      <nav className="nav nav-secondary" aria-label="Secondary">
        <button
          type="button"
          className={active === "Settings" ? "active" : ""}
          aria-current={active === "Settings" ? "page" : undefined}
          onClick={() => setView("Settings")}
        >
          <NavIcon name="Settings" />
          <span>{t(NAV_LABEL_KEY.Settings)}</span>
        </button>
      </nav>
      <div className="sidebar-spacer" />
      <div className="util-row">
        <button
          type="button"
          className="util-btn"
          aria-label={t("sidebar.helpAria")}
          onClick={() => setView("Settings")}
        >
          <UtilIcon name="help" />
        </button>
        <button
          type="button"
          className="util-btn"
          aria-label={t("sidebar.feedbackAria")}
          onClick={() => setView("Settings")}
        >
          <UtilIcon name="chat" />
        </button>
        <button
          type="button"
          className="util-btn"
          aria-label={t("sidebar.themeAria", { theme })}
          onClick={cycleTheme}
        >
          <UtilIcon name={themeIconName(theme)} />
        </button>
        <button
          type="button"
          className="util-btn"
          aria-label={t("sidebar.languageAria", { language: localeLabel })}
          onClick={cycleLocale}
        >
          <UtilIcon name="globe" />
        </button>
      </div>
    </aside>
  );
}
