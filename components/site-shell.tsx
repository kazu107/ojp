
import { DraftScope } from "@/components/draft-recovery";
import { getI18n } from "@/lib/i18n/server";
import { AuthControls } from "@/components/auth-controls";
import { LanguageSwitcher } from "@/components/language-switcher";
import { SiteNavigation } from "@/components/site-navigation";
import { SiteIcon } from "@/components/site-icon";
import { SITE_SOCIAL_LINKS } from "@/lib/site-links";
import { canCreateProblemByRole, getOptionalCurrentUser } from "@/lib/store";

export async function SiteShell({ children }: { children: React.ReactNode }) {
  const { t } = await getI18n();
  const me = await getOptionalCurrentUser();
  const canCreateProblem = me ? canCreateProblemByRole(me.role) : false;

  return (
    <div className="site-root">
      <SiteNavigation signedIn={!!me} isAdmin={me?.role === "admin"} canCreateProblem={canCreateProblem}>
        <AuthControls />
        <LanguageSwitcher />
      </SiteNavigation>
      <main className="site-main" id="main-content" tabIndex={-1}><DraftScope owner={me?.id ?? null}>{children}</DraftScope></main>
      <footer className="site-footer">
        <div className="site-footer-inner">
          <div className="site-footer-copy">
            <p className="site-footer-title">{t("OJP")}</p>
            <p className="site-footer-text">{t("Competitive Programming Platform")}</p>
          </div>
          <div className="site-footer-links">
            <a
              className="site-footer-link"
              href={SITE_SOCIAL_LINKS.twitter}
              target="_blank"
              rel="noreferrer"
            >
              {t("X / Twitter")}<SiteIcon name="external" /></a>
            <a
              className="site-footer-link"
              href={SITE_SOCIAL_LINKS.github}
              target="_blank"
              rel="noreferrer"
            >
              {t("GitHub")}<SiteIcon name="external" /></a>
          </div>
        </div>
      </footer>
    </div>
  );
}
