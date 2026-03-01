import Link from "next/link";
import { notFound } from "next/navigation";
import { RejudgeRequestForm } from "@/components/rejudge-request-form";
import { StatusBadge } from "@/components/status-badge";
import {
  badgeClassForSubmission,
  formatDate,
  languageLabel,
} from "@/lib/presentation";
import {
  canRequestRejudgeByViewer,
  getCurrentUser,
  getProblemById,
  getSubmissionWithAccess,
} from "@/lib/store";

interface SubmissionDetailPageProps {
  params: Promise<{
    submissionId: string;
  }>;
}

export default async function SubmissionDetailPage({ params }: SubmissionDetailPageProps) {
  const { submissionId } = await params;
  const me = getCurrentUser();
  const result = getSubmissionWithAccess(submissionId, me.id);

  if (!result) {
    notFound();
  }

  const { submission, canViewSource } = result;
  const problem = getProblemById(submission.problemId);
  const canRequestRejudge = canRequestRejudgeByViewer(submission, me.id);

  return (
    <div className="page">
      <section className="page-head">
        <div>
          <h1 className="page-title">Submission {submission.id}</h1>
          <p className="page-subtitle">
            提出の詳細結果です。テストケースごとの判定を確認できます。
          </p>
        </div>
        <div className="button-row">
          {problem ? (
            <Link className="button button-secondary" href={`/problems/${problem.id}`}>
              問題へ戻る
            </Link>
          ) : null}
          <Link
            className="button button-danger"
            href={`/reports/new?targetType=submission&targetId=${submission.id}`}
          >
            通報
          </Link>
        </div>
      </section>

      <section className="panel stack">
        <div className="meta-inline">
          <StatusBadge className={badgeClassForSubmission(submission.status)}>
            {submission.status}
          </StatusBadge>
          <span className="text-soft">
            Score: {submission.score} / Time: {submission.totalTimeMs} ms / Memory:{" "}
            {submission.peakMemoryKb} KB
          </span>
        </div>
        <p className="text-soft">
          Language: {languageLabel(submission.language)} / Submitted:{" "}
          {formatDate(submission.submittedAt)}
        </p>
      </section>

      <section className="panel stack">
        <h2 className="panel-title">Test Results</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Group</th>
                <th>Case</th>
                <th>Verdict</th>
                <th>Time</th>
                <th>Memory</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {submission.testResults.map((result) => (
                <tr key={result.id}>
                  <td>{result.groupName}</td>
                  <td>{result.testCaseName}</td>
                  <td>
                    <StatusBadge className={badgeClassForSubmission(result.verdict)}>
                      {result.verdict}
                    </StatusBadge>
                  </td>
                  <td>{result.timeMs} ms</td>
                  <td>{result.memoryKb} KB</td>
                  <td>{result.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel stack">
        <h2 className="panel-title">Rejudge Request</h2>
        {canRequestRejudge ? (
          <>
            <p className="text-soft">
              理由は必須で、`judge update / testcase fix / scoring bug / manual review` を選択できます。
            </p>
            <RejudgeRequestForm submissionId={submission.id} />
          </>
        ) : (
          <p className="empty">
            再ジャッジ要求は、管理者・問題作成者・対象コンテスト主催者のみ可能です。
          </p>
        )}
      </section>

      <section className="panel stack">
        <h2 className="panel-title">Source Code</h2>
        {canViewSource ? (
          <pre className="code-block">{submission.sourceCode}</pre>
        ) : (
          <p className="empty">
            ソースコード全文は提出者本人または管理者のみ閲覧できます。
          </p>
        )}
      </section>
    </div>
  );
}
