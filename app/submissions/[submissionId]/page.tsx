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
  languageLabel,
  submissionStatusLabel,
  testCaseVisibilityLabel,
} from "@/lib/presentation";
import { pickHighestPriorityVerdict } from "@/lib/submission-status";
import {
  canRequestRejudgeByViewer,
  findUser,
  getOptionalCurrentUser,
  getProblemPackageData,
  getProblemById,
  getSubmissionWithAccess,
} from "@/lib/store";
import { Submission, SubmissionStatus } from "@/lib/types";
import { isWaitingSubmissionStatus } from "@/lib/submission-status";

interface SubmissionDetailPageProps {
  params: Promise<{
    submissionId: string;
  }>;
}

interface GroupedTestResults {
  groupName: string;
  verdict: SubmissionStatus;
  caseCount: number;
  maxTimeMs: number;
  peakMemoryKb: number;
  cases: Submission["testResults"];
}

function pickGroupedVerdict(results: Submission["testResults"]): SubmissionStatus {
  const finalVerdicts = results
    .map((entry) => entry.verdict)
    .filter((status) => !isWaitingSubmissionStatus(status));

  if (finalVerdicts.length === 0) {
    return "queued";
  }
  if (finalVerdicts.some((status) => status !== "accepted")) {
    return pickHighestPriorityVerdict(finalVerdicts);
  }
  if (results.some((entry) => isWaitingSubmissionStatus(entry.verdict))) {
    return "queued";
  }
  return "accepted";
}

function groupTestResults(results: Submission["testResults"]): GroupedTestResults[] {
  const grouped = new Map<string, Submission["testResults"]>();
  for (const result of results) {
    const entries = grouped.get(result.groupName) ?? [];
    entries.push(result);
    grouped.set(result.groupName, entries);
  }

  return [...grouped.entries()].map(([groupName, cases]) => ({
    groupName,
    verdict: pickGroupedVerdict(cases),
    caseCount: cases.length,
    maxTimeMs: cases.reduce((max, entry) => Math.max(max, entry.timeMs), 0),
    peakMemoryKb: cases.reduce((max, entry) => Math.max(max, entry.memoryKb), 0),
    cases,
  }));
}

function waitingResult(groupName: string, testCaseName: string): Submission["testResults"][number] {
  return {
    id: `waiting-${groupName}-${testCaseName}`,
    groupName,
    testCaseName,
    verdict: "queued",
    timeMs: 0,
    memoryKb: 0,
    message: "Waiting Judge",
  };
}

function detailVerdictLabel(status: SubmissionStatus): string {
  return isWaitingSubmissionStatus(status) ? "WJ" : submissionStatusLabel(status);
}

function buildDisplayResults(input: {
  submission: Submission;
  testCaseVisibility: "group_only" | "case_index_only" | "case_name_visible";
  canViewSource: boolean;
  packageData:
    | Awaited<ReturnType<typeof getProblemPackageData>>
    | null
    | undefined;
}): Submission["testResults"] {
  const actualByKey = new Map(
    input.submission.testResults.map((result) => [
      `${result.groupName}::${result.testCaseName}`,
      result,
    ]),
  );

  if (!input.packageData) {
    return input.submission.testResults;
  }

  const waiting = isWaitingSubmissionStatus(input.submission.status);
  if (!waiting) {
    return input.submission.testResults;
  }

  if (!input.canViewSource && input.testCaseVisibility === "group_only") {
    return input.packageData.groups.map((group) => {
      const groupActualResults = group.tests
        .map((testCase) => actualByKey.get(`${group.name}::${testCase.name}`))
        .filter((result): result is Submission["testResults"][number] => Boolean(result));
      if (groupActualResults.length === 0) {
        return waitingResult(group.name, "-");
      }
      const summaryVerdict = groupActualResults.some((result) => result.verdict !== "accepted")
        ? pickHighestPriorityVerdict(groupActualResults.map((result) => result.verdict))
        : "queued";
      return {
        id: `waiting-group-${group.name}`,
        groupName: group.name,
        testCaseName: "-",
        verdict: summaryVerdict,
        timeMs: groupActualResults.reduce((max, result) => Math.max(max, result.timeMs), 0),
        memoryKb: groupActualResults.reduce((max, result) => Math.max(max, result.memoryKb), 0),
        message:
          groupActualResults.length === group.tests.length
            ? "Judged"
            : "Waiting Judge",
      };
    });
  }

  let caseIndex = 0;
  return input.packageData.groups.flatMap((group) =>
    group.tests.map((testCase) => {
      caseIndex += 1;
      const actual = actualByKey.get(`${group.name}::${testCase.name}`);
      if (actual) {
        return actual;
      }
      const visibleCaseName =
        !input.canViewSource && input.testCaseVisibility === "case_index_only"
          ? `#${caseIndex}`
          : testCase.name;
      return waitingResult(group.name, visibleCaseName);
    }),
  );
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
  const user = findUser(submission.userId);
  const canRequestRejudge = me ? canRequestRejudgeByViewer(submission, me.id) : false;
  const testCaseVisibility = problem?.testCaseVisibility ?? "case_index_only";
  const packageData = problem ? await getProblemPackageData(problem.id) : null;
  const displayResults = buildDisplayResults({
    submission,
    testCaseVisibility,
    canViewSource,
    packageData,
  });
  const groupedResults = groupTestResults(displayResults);
  const canExpandCaseDetails = canViewSource || testCaseVisibility !== "group_only";

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
            {detailVerdictLabel(submission.status)}
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
        <p className="text-soft">
          User: {user?.displayName ?? submission.userId} ({submission.userId})
        </p>
        <p className="text-soft">
          Language: {languageLabel(submission.language)} / Submitted: {formatDate(submission.submittedAt)}
        </p>
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
        {displayResults.length === 0 ? (
          <p className="empty">No test result data is available.</p>
        ) : (
          <div className="stack">
            {groupedResults.map((group) => (
              <details key={group.groupName} className="result-group">
                <summary className="result-group-summary">
                  <span className="kpi">{group.groupName}</span>
                  <StatusBadge className={badgeClassForSubmission(group.verdict)}>
                    {detailVerdictLabel(group.verdict)}
                  </StatusBadge>
                  <span className="result-group-meta">Cases: {group.caseCount}</span>
                  <span className="result-group-meta">
                    Time(max): {group.maxTimeMs} ms
                  </span>
                  <span className="result-group-meta">Memory: {group.peakMemoryKb} KB</span>
                </summary>
                <div className="result-group-body">
                  {canExpandCaseDetails ? (
                    <div className="table-wrap">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Case</th>
                            <th>Verdict</th>
                            <th>Time</th>
                            <th>Memory</th>
                            <th>Message</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.cases.map((result) => (
                            <tr key={result.id}>
                              <td>{result.testCaseName}</td>
                              <td>
                                <StatusBadge className={badgeClassForSubmission(result.verdict)}>
                                  {detailVerdictLabel(result.verdict)}
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
                  ) : (
                    <p className="text-soft">
                      Individual test cases are hidden by test case visibility policy.
                    </p>
                  )}
                </div>
              </details>
            ))}
          </div>
        )}
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
