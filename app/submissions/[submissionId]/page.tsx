import Link from "next/link";
import { notFound } from "next/navigation";
import { RejudgeRequestForm } from "@/components/rejudge-request-form";
import { SubmissionLiveRefresh } from "@/components/submission-live-refresh";
import { StatusBadge } from "@/components/status-badge";
import {
  badgeClassForDifficulty,
  badgeClassForSubmission,
  difficultyLabel,
  formatDate,
  submissionStatusLabel,
  testCaseVisibilityLabel,
} from "@/lib/presentation";
import {
  canRequestRejudgeByViewer,
  getOptionalCurrentUser,
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
  const me = await getOptionalCurrentUser();
  const result = getSubmissionWithAccess(submissionId, me?.id ?? "guest");

  if (!result) {
    notFound();
  }

  const { submission, canViewSource } = result;
  const problem = getProblemById(submission.problemId);
  const canRequestRejudge = me ? canRequestRejudgeByViewer(submission, me.id) : false;
  const testCaseVisibility = problem?.testCaseVisibility ?? "case_index_only";

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
        <SubmissionLiveRefresh status={submission.status} />
        <div className="meta-inline">
          <StatusBadge className={badgeClassForSubmission(submission.status)}>
            {submissionStatusLabel(submission.status)}
          </StatusBadge>
          <span className="text-soft">
            Score: {submission.score} / Time: {submission.totalTimeMs} ms / Memory:{" "}
            {submission.peakMemoryKb} KB
          </span>
        </div>
        <p className="text-soft">
          Problem:{" "}
          {problem ? (
            <Link className="link" href={`/problems/${problem.id}`}>
              {problem.title}
            </Link>
          ) : (
            submission.problemId
          )}{" "}
          {problem ? (
            <StatusBadge className={badgeClassForDifficulty(problem.difficulty)}>
              {difficultyLabel(problem.difficulty)}
            </StatusBadge>
          ) : null}
        </p>
        <p className="text-soft">Submitted: {formatDate(submission.submittedAt)}</p>
        <p className="text-soft">
          Judge Start: {submission.judgeStartedAt ? formatDate(submission.judgeStartedAt) : "-"} /
          Judged: {submission.judgedAt ? formatDate(submission.judgedAt) : "-"} / Judge Env:{" "}
          {submission.judgeEnvironmentVersion ?? "-"}
        </p>
      </section>

      <section className="panel stack">
        <h2 className="panel-title">Test Results</h2>
        <p className="text-soft">
          Visibility mode: {testCaseVisibilityLabel(testCaseVisibility)}
          {!canViewSource ? " (applied for non-owner viewers)" : ""}
        </p>
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
              {submission.testResults.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-soft">
                    No per-test result yet. The submission is still being judged.
                  </td>
                </tr>
              ) : (
                submission.testResults.map((result) => (
                  <tr key={result.id}>
                    <td>{result.groupName}</td>
                    <td>{result.testCaseName}</td>
                    <td>
                      <StatusBadge className={badgeClassForSubmission(result.verdict)}>
                        {submissionStatusLabel(result.verdict)}
                      </StatusBadge>
                    </td>
                    <td>{result.timeMs} ms</td>
                    <td>{result.memoryKb} KB</td>
                    <td>{result.message}</td>
                  </tr>
                ))
              )}
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
