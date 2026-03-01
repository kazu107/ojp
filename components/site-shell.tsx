import Link from "next/link";
import { AuthControls } from "@/components/auth-controls";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/problems", label: "Problems" },
  { href: "/submissions", label: "Submissions" },
  { href: "/contests", label: "Contests" },
  { href: "/me", label: "Profile" },
  { href: "/admin", label: "Admin" },
];

export async function SiteShell({ children }: { children: React.ReactNode }) {
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
            <Link href="/problems/new" className="site-nav-cta">
              New Problem
            </Link>
            <AuthControls />
          </nav>
        </div>
      </header>
      <div className="site-backdrop" />
      <main className="site-main">{children}</main>
    </div>
  );
}
