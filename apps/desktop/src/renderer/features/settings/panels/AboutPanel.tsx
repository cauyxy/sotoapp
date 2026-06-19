import { useEffect, useState } from "react";

import { health } from "../../../ipc";
import { SotoMark } from "../../../shared/ui/primitives/SotoMark";
import { useT } from "../../../i18n/context";

const APP_NAME = "Soto";
const REPOSITORY_URL = "https://github.com/cauyxy/sotoapp";

export function AboutPanel(): JSX.Element {
  const t = useT();
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void health().then((status) => {
      if (!cancelled) setVersion(status.version);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (version === null) {
    return <div className="about-card" />;
  }

  return (
    <div className="about-card">
      <section className="about-hero">
        <span className="about-hero-glyph">
          <SotoMark size={48} />
        </span>
        <div className="about-hero-name">{APP_NAME}</div>
        <div className="about-hero-version">
          {t("settings.about.versionLine", { version })}
        </div>
        <div className="about-hero-tagline">{t("settings.about.tagline")}</div>
      </section>
      <div className="about-divider" />
      <div className="about-actions">
        <a
          className="about-repository-link"
          href={REPOSITORY_URL}
          target="_blank"
          rel="noreferrer noopener"
        >
          {t("settings.about.repositoryLabel")}
        </a>
      </div>
      <div className="about-signature">{t("settings.about.signature")}</div>
    </div>
  );
}
