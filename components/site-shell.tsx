import Link from "next/link";
import { AuthControls } from "@/components/auth-controls";
import { SITE_SOCIAL_LINKS } from "@/lib/site-links";
import { canCreateProblemByRole, getOptionalCurrentUser } from "@/lib/store";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/problems", label: "Problems" },
  { href: "/submissions", label: "Submissions" },
  { href: "/contests", label: "Contests" },
  { href: "/me", label: "Profile" },
  { href: "/admin", label: "Admin" },
];

export async function SiteShell({ children }: { children: React.ReactNode }) {
  const me = await getOptionalCurrentUser();
  const canCreateProblem = me ? canCreateProblemByRole(me.role) : false;

  return (
    <div className="site-root">
      <header className="site-header">
        <div className="site-header-inner">
          <Link className="site-logo" href="/">
            OJP
            <span className="site-logo-sub">AtCoder-like Platform</span>
          </Link>
          <nav className="site-nav" aria-label="global">
            {links.map((link) => (
              <Link key={link.href} href={link.href} className="site-nav-link">
                {link.label}
              </Link>
            ))}
            {canCreateProblem ? (
              <Link href="/problems/new" className="site-nav-cta">
                New Problem
              </Link>
            ) : null}
            <AuthControls />
          </nav>
        </div>
      </header>
      <div className="site-backdrop" />
      <main className="site-main">{children}</main>
      <footer className="site-footer">
        <div className="site-footer-inner">
          <div className="site-footer-copy">
            <p className="site-footer-title">OJP</p>
            <p className="site-footer-text">AtCoder-like Platform MVP</p>
          </div>
          <div className="site-footer-links">
            <a
              className="site-footer-link"
              href={SITE_SOCIAL_LINKS.twitter}
              target="_blank"
              rel="noreferrer"
            >
              X / Twitter
            </a>
            <a
              className="site-footer-link"
              href={SITE_SOCIAL_LINKS.github}
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
