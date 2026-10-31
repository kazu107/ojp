import { reviewIsDue } from "@/lib/problem-discovery";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getI18n } from "@/lib/i18n/server";
import { getOptionalCurrentUser, getProblemForViewer } from "@/lib/store";
import { studyEntries, studyEntry } from "@/lib/problem-workspace-store";
import { ProblemStudy } from "@/components/problem-study";

export const dynamic = "force-dynamic";
export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ view?: string; page?: string }> }) {
  const { t } = await getI18n();
  const user = await getOptionalCurrentUser();
  if (!user) redirect("/signin?callbackUrl=%2Freview");
  const params = await searchParams;
  const view = ["all", "bookmarks", "due"].includes(params.view ?? "") ? params.view! : "due";
  const entries = (await studyEntries(user.id)).filter(row => {
    if (!getProblemForViewer(row.problemId, user.id)) return false;
    return view === "bookmarks" ? row.bookmarked : view === "due" ? reviewIsDue(row) : true;
  });
  const pages = Math.max(1, Math.ceil(entries.length / 20));
  const page = Math.min(pages, Math.max(1, Math.floor(Number(params.page)) || 1));
  const visible = await Promise.all(entries.slice((page - 1) * 20, page * 20).map(row => studyEntry(user.id, row.problemId)));
  return <div className="page">
    <section className="page-head"><h1 className="page-title">{t("Bookmarks and Review")}</h1></section>
    <nav className="button-row" aria-label={t("Review Filters")}>
      <Link className="button button-secondary" href="/review?view=due">{t("Due for Review")}</Link>
      <Link className="button button-secondary" href="/review?view=bookmarks">{t("Bookmarks")}</Link>
      <Link className="button button-secondary" href="/review?view=all">{t("All Saved Notes")}</Link>
    </nav>
    {!visible.length ? <p className="panel">{t("No matching saved problems.")}</p> : null}
    {visible.map(row => { if (!row) return null; const problem = getProblemForViewer(row.problemId, user.id); if (!problem) return null; return <section key={row.problemId} className="stack">
      <h2><Link className="link" href={`/problems/${problem.id}`}>{problem.title}</Link></h2>
      <details><summary>{t("Edit Private Notes")}</summary><ProblemStudy problemId={problem.id} initial={{ ...row, reviewAt: row.reviewAt?.toISOString() ?? null }} /></details>
    </section>; })}
    <div className="button-row">{page > 1 ? <Link className="link" href={`/review?view=${view}&page=${page - 1}`}>{t("Previous")}</Link> : null}<span>{page} / {pages}</span>{page < pages ? <Link className="link" href={`/review?view=${view}&page=${page + 1}`}>{t("Next")}</Link> : null}</div>
  </div>;
}
