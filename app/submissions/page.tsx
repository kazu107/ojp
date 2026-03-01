import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import {
  badgeClassForSubmission,
  formatDate,
  languageLabel,
} from "@/lib/presentation";
import {
  findUser,
  getProblemById,
  listSubmissionsForViewer,
} from "@/lib/store";

export const dynamic = "force-dynamic";

export default function SubmissionsPage() {
  const submissions = listSubmissionsForViewer("public");

  return (
    <div className="page">
      <section className="page-head">
        <div>
          <h1 className="page-title">Submissions</h1>
          <p className="page-subtitle">
            提出詳細の公開方針に沿って、判定・得点・時間・メモリは公開されます。ソースコード本文は提出者本人または管理者のみ閲覧可能です。
          </p>
        </div>
      </section>

      <section className="panel">
        {submissions.length === 0 ? (
          <p className="empty">提出データはまだありません。</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>User</th>
                  <th>Problem</th>
                  <th>Language</th>
                  <th>Status</th>
                  <th>Score</th>
                  <th>Time</th>
                  <th>Memory</th>
                  <th>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((submission) => {
                  const problem = getProblemById(submission.problemId);
                  const user = findUser(submission.userId);
                  return (
                    <tr key={submission.id}>
                      <td>
                        <Link className="link" href={`/submissions/${submission.id}`}>
                          {submission.id}
                        </Link>
                      </td>
                      <td>{user?.displayName ?? submission.userId}</td>
                      <td>
                        {problem ? (
                          <Link className="link" href={`/problems/${problem.id}`}>
                            {problem.title}
                          </Link>
                        ) : (
                          submission.problemId
                        )}
                      </td>
                      <td>{languageLabel(submission.language)}</td>
                      <td>
                        <StatusBadge className={badgeClassForSubmission(submission.status)}>
                          {submission.status}
                        </StatusBadge>
                      </td>
                      <td>{submission.score}</td>
                      <td>{submission.totalTimeMs} ms</td>
                      <td>{submission.peakMemoryKb} KB</td>
                      <td>{formatDate(submission.submittedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
