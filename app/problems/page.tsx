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
} from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function ProblemsPage() {
  const me = await getOptionalCurrentUser();
  const canCreateProblem = me ? canCreateProblemByRole(me.role) : false;
  const problems = listProblemsForListView(me?.id ?? "guest");

  return (
    <div className="page">
      <section className="page-head">
        <div>
          <h1 className="page-title">Problems</h1>
          <p className="page-subtitle">
            問題一覧です。公開範囲と制約情報を確認できます。
          </p>
        </div>
        <div className="button-row">
          {canCreateProblem ? (
            <Link href="/problems/new" className="button">
              新規作成
            </Link>
          ) : null}
        </div>
      </section>

      <section className="panel">
        {problems.length === 0 ? (
          <p className="empty">表示できる問題がありません。</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Difficulty</th>
                  <th>Visibility</th>
                  <th>Limits</th>
                  <th>Author</th>
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {problems.map((problem) => (
                  <tr key={problem.id}>
                    <td>
                      <Link className="link" href={`/problems/${problem.id}`}>
                        {problem.title}
                      </Link>
                    </td>
                    <td>
                      <StatusBadge className={badgeClassForDifficulty(problem.difficulty)}>
                        {difficultyLabel(problem.difficulty)}
                      </StatusBadge>
                    </td>
                    <td>
                      <StatusBadge className={badgeClassForVisibility(problem.visibility)}>
                        {visibilityLabel(problem.visibility)}
                      </StatusBadge>
                    </td>
                    <td>
                      {problem.timeLimitMs} ms / {problem.memoryLimitMb} MB
                    </td>
                    <td>{findUser(problem.authorId)?.displayName ?? problem.authorId}</td>
                    <td>{formatDate(problem.updatedAt)}</td>
                    <td>
                      <div className="button-row">
                        <Link className="link" href={`/problems/${problem.id}/submit`}>
                          Submit
                        </Link>
                        {me && canEditProblemByViewer(problem, me.id) ? (
                          <Link className="link" href={`/problems/${problem.id}/edit`}>
                            Edit
                          </Link>
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
