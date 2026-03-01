import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import {
  badgeClassForVisibility,
  formatDate,
  languageLabel,
  visibilityLabel,
} from "@/lib/presentation";
import { findUser, getCurrentUser, listProblemsForListView } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function ProblemsPage() {
  const me = await getCurrentUser();
  const problems = listProblemsForListView(me.id);

  return (
    <div className="page">
      <section className="page-head">
        <div>
          <h1 className="page-title">Problems</h1>
          <p className="page-subtitle">
            問題一覧です。`public / unlisted / private` の公開範囲と、制約・言語情報を一覧で確認できます。
          </p>
        </div>
        <div className="button-row">
          <Link href="/problems/new" className="button">
            新規作成
          </Link>
        </div>
      </section>

      <section className="panel">
        {problems.length === 0 ? (
          <p className="empty">問題がまだ登録されていません。</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Visibility</th>
                  <th>Limits</th>
                  <th>Languages</th>
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
                      <StatusBadge className={badgeClassForVisibility(problem.visibility)}>
                        {visibilityLabel(problem.visibility)}
                      </StatusBadge>
                    </td>
                    <td>
                      {problem.timeLimitMs} ms / {problem.memoryLimitMb} MB
                    </td>
                    <td>{problem.supportedLanguages.map((language) => languageLabel(language)).join(", ")}</td>
                    <td>{findUser(problem.authorId)?.displayName ?? problem.authorId}</td>
                    <td>{formatDate(problem.updatedAt)}</td>
                    <td>
                      <div className="button-row">
                        <Link className="link" href={`/problems/${problem.id}/submit`}>
                          Submit
                        </Link>
                        <Link className="link" href={`/problems/${problem.id}/edit`}>
                          Edit
                        </Link>
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
