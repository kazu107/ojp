
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

export default async function ProblemsPage() {
  const { t, locale } = await getI18n();
  const me = await getOptionalCurrentUser();
  const canCreateProblem = me ? canCreateProblemByRole(me.role) : false;
  const problems = listProblemsForListView(me?.id ?? "guest");
  const acceptedProblemIds = me
    ? new Set(
        listSubmissionsForViewer(me.id, {
          userId: me.id,
          status: "accepted",
        }).map((submission) => submission.problemId),
      )
    : new Set<string>();

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
                    className={acceptedProblemIds.has(problem.id) ? "problem-row-solved" : undefined}
                  >
                    <td>
                      <Link className="link" href={`/problems/${problem.id}`}>
                        {problem.title}
                      </Link>
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
    </div>
  );
}
