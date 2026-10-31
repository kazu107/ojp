import { ProblemFilters } from "@/components/problem-filters";
import { problemTags, studyEntries, discoveryStatuses } from "@/lib/problem-workspace-store";
import { filterProblems, problemProgress, type DiscoveryFilters } from "@/lib/problem-discovery";

import { getI18n } from "@/lib/i18n/server";
import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import {
  badgeClassForDifficulty,
  badgeClassForVisibility,
  difficultyLabel,
  formatDate,
  visibilityLabel,
} from "@/lib/presentation";
import {
  canCreateProblemByRole,
  canEditProblemByViewer,
  findUser,
  getOptionalCurrentUser,
  listProblemsForListView,
  listSubmissionsForViewer,
} from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function ProblemsPage({searchParams}:{searchParams:Promise<DiscoveryFilters & {page?:string}>}) {
  const { t, locale } = await getI18n();
  const me = await getOptionalCurrentUser();
  const canCreateProblem = me ? canCreateProblemByRole(me.role) : false;
  const allProblems = listProblemsForListView(me?.id ?? "guest");
  const filters=await searchParams;
  const tags=await problemTags(allProblems.map(problem=>problem.id));
  const progress=problemProgress(me?await discoveryStatuses(listSubmissionsForViewer(me.id,{userId:me.id})):[]);
  const bookmarks=new Set(me?(await studyEntries(me.id)).filter(row=>row.bookmarked).map(row=>row.problemId):[]);
  const filtered=filterProblems(allProblems,me?filters:{...filters,progress:"all",saved:""},tags,progress,bookmarks);
  const pages=Math.max(1,Math.ceil(filtered.length/50));
  const page=Math.min(pages,Math.max(1,Math.floor(Number(filters.page)||1)));
  const problems=filtered.slice((page-1)*50,page*50);
  const pageUrl=(target:number)=>{const params=new URLSearchParams();for(const key of ["q","tag","min","max","progress","saved"] as const)if(filters[key])params.set(key,filters[key]!);params.set("page",String(target));return "/problems?"+params.toString()};

  return (
    <div className="page">
      <section className="page-head">
        <div>
          <h1 className="page-title">{t("Problems")}</h1>
          <p className="page-subtitle">
            {t("問題一覧です。公開範囲と制約情報を確認できます。")}</p>
        </div>
        <div className="button-row">
          {canCreateProblem ? (
            <Link href="/problems/new" className="button">
              {t("新規作成")}</Link>
          ) : null}
        </div>
      </section>

      <ProblemFilters filters={filters} tags={[...new Set([...tags.values()].flat())].sort()} loggedIn={!!me} />
      <p className="text-soft">{t("Matching problems: {count}",{count:filtered.length})}</p>
      <section className="panel">
        {problems.length === 0 ? (
          <p className="empty">{t("表示できる問題がありません。")}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("Title")}</th>
                  <th>{t("Difficulty")}</th>
                  <th>{t("Visibility")}</th>
                  <th>{t("Limits")}</th>
                  <th>{t("Author")}</th>
                  <th>{t("Updated")}</th>
                  <th>{t("Actions")}</th>
                </tr>
              </thead>
              <tbody>
                {problems.map((problem) => (
                  <tr
                    key={problem.id}
                    className={progress.get(problem.id) === "solved" ? "problem-row-solved" : undefined}
                  >
                    <td>
                      <Link className="link" href={`/problems/${problem.id}`}>
                        {problem.title}
                      </Link>
                      <div className="meta-inline">{(tags.get(problem.id)??[]).map(tag=><Link key={tag} className="badge badge-blue" href={`/problems?tag=${encodeURIComponent(tag)}`}>{tag}</Link>)}</div>
                    </td>
                    <td>
                      <StatusBadge className={badgeClassForDifficulty(problem.difficulty)}>
                        {t(difficultyLabel(problem.difficulty))}
                      </StatusBadge>
                    </td>
                    <td>
                      <StatusBadge className={badgeClassForVisibility(problem.visibility)}>
                        {t(visibilityLabel(problem.visibility))}
                      </StatusBadge>
                    </td>
                    <td>
                      {problem.timeLimitMs} {t(" ms / ")}{problem.memoryLimitMb} {t(" MB")}</td>
                    <td>{findUser(problem.authorId)?.displayName ?? problem.authorId}</td>
                    <td>{formatDate(problem.updatedAt, locale)}</td>
                    <td>
                      <div className="button-row">
                        <Link className="link" href={`/problems/${problem.id}/submit`}>
                          {t("Submit")}</Link>
                        {me && canEditProblemByViewer(problem, me.id) ? (
                          <Link className="link" href={`/problems/${problem.id}/edit`}>
                            {t("Edit")}</Link>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <div className="button-row">{page>1?<Link className="link" href={pageUrl(page-1)}>{t("Previous")}</Link>:null}<span>{page} / {pages}</span>{page<pages?<Link className="link" href={pageUrl(page+1)}>{t("Next")}</Link>:null}</div>
    </div>
  );
}
