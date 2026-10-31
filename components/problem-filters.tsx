"use client";
import Link from "next/link";
import { useI18n } from "./i18n-provider";
import type { DiscoveryFilters } from "@/lib/problem-discovery";

export function ProblemFilters({ filters, tags, loggedIn }: { filters: DiscoveryFilters; tags: string[]; loggedIn: boolean }) {
  const { t } = useI18n();
  return <form className="panel stack" action="/problems" method="get">
    <div className="form-grid">
      <label className="field"><span className="field-label">{t("Search Problems")}</span><input className="input" type="search" name="q" maxLength={200} defaultValue={filters.q ?? ""} placeholder={t("Title, slug or tag")} /></label>
      <label className="field"><span className="field-label">{t("Tags")}</span><select className="select" name="tag" defaultValue={filters.tag ?? ""}><option value="">{t("All Tags")}</option>{tags.map(tag => <option key={tag} value={tag}>{tag}</option>)}</select></label>
      <label className="field"><span className="field-label">{t("Minimum Difficulty")}</span><input className="input" type="number" step={1} name="min" defaultValue={filters.min ?? ""} /></label>
      <label className="field"><span className="field-label">{t("Maximum Difficulty")}</span><input className="input" type="number" step={1} name="max" defaultValue={filters.max ?? ""} /></label>
      <label className="field"><span className="field-label">{t("Progress")}</span><select className="select" name="progress" disabled={!loggedIn} defaultValue={filters.progress ?? "all"}><option value="all">{t("All Problems")}</option><option value="unattempted">{t("Unattempted")}</option><option value="attempted">{t("Attempted")}</option><option value="solved">{t("Solved")}</option></select></label>
      <label><input type="checkbox" name="saved" value="1" disabled={!loggedIn} defaultChecked={filters.saved === "1"} /> {t("Bookmarked Only")}</label>
    </div>
    {!loggedIn ? <p className="text-soft">{t("Sign in to filter your progress and bookmarks.")}</p> : null}
    <div className="button-row"><button className="button" type="submit">{t("Search")}</button><Link className="button button-secondary" href="/problems">{t("Reset Filters")}</Link></div>
  </form>;
}
