// Settings page. Renders
// the settings sections top-to-bottom (Permissions is macOS-only) inside
// the .settings-flow / .settings-section layout. Each section's body is a
// self-contained panel under ./panels/. Model engine wiring now lives on Models.

import { PageHeader } from "../../shared/ui/primitives/PageHeader";
import { useT } from "../../i18n/context";
import {
  SETTINGS_SECTION_LABEL_KEY,
  isMacOS,
  type SettingsSection,
} from "./panels/constants";
import { PermissionPanel } from "./panels/PermissionPanel";
import { MicrophonePanel } from "./panels/MicrophonePanel";
import { NetworkPanel } from "./panels/NetworkPanel";
import { GeneralPanel } from "./panels/GeneralPanel";
import { AboutPanel } from "./panels/AboutPanel";
import "./panels/settings.css";

function Section({
  section,
  label,
  action,
  children,
}: {
  section: SettingsSection;
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="settings-section" data-section={section}>
      <header className="settings-section-head">
        <h2>{label}</h2>
        {action ?? null}
      </header>
      <div className="settings-section-body">
        {children}
      </div>
    </section>
  );
}

export function SettingsPage(): JSX.Element {
  const t = useT();
  const showPermissions = isMacOS();
  const label = (section: SettingsSection): string =>
    t(SETTINGS_SECTION_LABEL_KEY[section]);

  return (
    <section className="page settings-page">
      <div className="settings-flow">
        <div className="settings-flow-content">
          <PageHeader title={t("settings.page.title")} />

          {showPermissions ? (
            <Section section="Permissions" label={label("Permissions")}>
              <PermissionPanel />
            </Section>
          ) : null}

          <Section section="Microphone" label={label("Microphone")}>
            <MicrophonePanel />
          </Section>

          <Section section="Network" label={label("Network")}>
            <NetworkPanel />
          </Section>

          <Section section="General" label={label("General")}>
            <GeneralPanel />
          </Section>

          <Section section="About" label={label("About")}>
            <AboutPanel />
          </Section>
        </div>
      </div>
    </section>
  );
}
