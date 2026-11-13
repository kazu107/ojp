"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/components/i18n-provider";
import { SiteIcon, type SiteIconName } from "@/components/site-icon";

const links: { href: string; label: string; icon: SiteIconName }[] = [
  { href: "/", label: "Dashboard", icon: "dashboard" },
  { href: "/problems", label: "Problems", icon: "problems" },
  { href: "/learn", label: "Learn", icon: "learn" },
  { href: "/contests", label: "Contests", icon: "contests" },
  { href: "/submissions", label: "Submissions", icon: "submissions" },
  { href: "/ratings", label: "Ratings", icon: "ratings" },
];

export function SiteNavigation({ signedIn, isAdmin, canCreateProblem, children }: {
  signedIn: boolean;
  isAdmin: boolean;
  canCreateProblem: boolean;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const pathname = usePathname();
  const [menu, setMenu] = useState({ path: pathname, open: false });
  const toggle = useRef<HTMLButtonElement>(null);
  // Also reset after browser back/forward, while keeping the header DOM stable.
  if (menu.path !== pathname) setMenu({ path: pathname, open: false });
  const open = menu.path === pathname && menu.open;
  const closeMenu = () => setMenu({ path: pathname, open: false });
  const active = (href: string) => href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
  const navLink = ({ href, label, icon }: typeof links[number]) => (
    <Link key={href} href={href} className="site-nav-link" aria-current={active(href) ? "page" : undefined} onClick={closeMenu}>
      <SiteIcon name={icon} /><span>{t(label)}</span>
    </Link>
  );

  return (
    <header className={`site-header${open ? " is-menu-open" : ""}`} onKeyDown={(event) => {
      if (event.key === "Escape" && open) {
        closeMenu();
        toggle.current?.focus();
      }
    }}>
      <a className="skip-link" href="#main-content">{t("Skip to content")}</a>
      <div className="site-header-inner">
        <Link className="site-logo" href="/" onClick={closeMenu}>
          <span className="site-logo-mark"><SiteIcon name="submissions" /></span>
          <span className="site-logo-name">{t("OJP")}<span className="site-logo-sub">{t("Competitive Programming Platform")}</span></span>
        </Link>
        <button ref={toggle} className="site-menu-toggle" type="button" aria-expanded={open} aria-controls="site-navigation site-header-actions" onClick={() => setMenu({ path: pathname, open: !open })}>
          <SiteIcon name={open ? "close" : "menu"} /><span>{t(open ? "Close Menu" : "Menu")}</span>
        </button>
        <div className="site-header-actions" id="site-header-actions">{children}</div>
        <nav className="site-nav" id="site-navigation" aria-label={t("global")}>
          <div className="site-nav-primary">{links.map(navLink)}</div>
          <div className="site-nav-secondary">
            {signedIn ? navLink({ href: "/review", label: "Bookmarks and Review", icon: "review" }) : null}
            {signedIn ? navLink({ href: "/me", label: "Profile", icon: "profile" }) : null}
            {isAdmin ? navLink({ href: "/admin", label: "Admin", icon: "admin" }) : null}
            {canCreateProblem ? <Link href="/problems/new" className="site-nav-create" onClick={closeMenu}><SiteIcon name="plus" />{t("New Problem")}</Link> : null}
          </div>
        </nav>
      </div>
    </header>
  );
}
