
import { DraftScope } from "@/components/draft-recovery";
import { getI18n } from "@/lib/i18n/server";
import Link from "next/link";
import { AuthControls } from "@/components/auth-controls";
import { LanguageSwitcher } from "@/components/language-switcher";
import { SITE_SOCIAL_LINKS } from "@/lib/site-links";
import { canCreateProblemByRole, getOptionalCurrentUser } from "@/lib/store";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/problems", label: "Problems" },
  { href: "/learn", label: "Learn" },
  { href: "/review", label: "Bookmarks and Review" },
  { href: "/submissions", label: "Submissions" },
  { href: "/contests", label: "Contests" },
  { href: "/ratings", label: "Ratings" },
  { href: "/me", label: "Profile" },
  { href: "/admin", label: "Admin" },
];

export async function SiteShell({ children }: { children: React.ReactNode }) {
  const { t } = await getI18n();
  const me = await getOptionalCurrentUser();
  const canCreateProblem = me ? canCreateProblemByRole(me.role) : false;

  return (
    <div className="site-root">
      <header className="site-header">
        <div className="site-header-inner">
          <Link className="site-logo" href="/">
            {t("OJP")}<span className="site-logo-sub">{t("AtCoder-like Platform")}</span>
          </Link>
          <nav className="site-nav" aria-label={t("global")}>
            {links.map((link) => (
              <Link key={link.href} href={link.href} className="site-nav-link">
                {t(link.label)}
              </Link>
            ))}
            {canCreateProblem ? (
              <Link href="/problems/new" className="site-nav-cta">
                {t("New Problem")}</Link>
            ) : null}
            <AuthControls />
            <LanguageSwitcher />
          </nav>
        </div>
      </header>
      <div className="site-backdrop" />
      <main className="site-main"><DraftScope owner={me?.id ?? null}>{children}</DraftScope></main>
      <footer className="site-footer">
        <div className="site-footer-inner">
          <div className="site-footer-copy">
            <p className="site-footer-title">{t("OJP")}</p>
            <p className="site-footer-text">{t("AtCoder-like Platform MVP")}</p>
          </div>
          <div className="site-footer-links">
            <a
              className="site-footer-link"
              href={SITE_SOCIAL_LINKS.twitter}
              target="_blank"
              rel="noreferrer"
            >
              {t("X / Twitter")}</a>
            <a
              className="site-footer-link"
              href={SITE_SOCIAL_LINKS.github}
              target="_blank"
              rel="noreferrer"
            >
              {t("GitHub")}</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
