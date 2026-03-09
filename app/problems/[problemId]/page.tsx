import Link from "next/link";
import { notFound } from "next/navigation";
import { MarkdownBlock } from "@/components/markdown-block";
import { StatusBadge } from "@/components/status-badge";
import {
  badgeClassForDifficulty,
  badgeClassForVisibility,
  difficultyLabel,
  explanationVisibilityLabel,
  formatDate,
  testCaseVisibilityLabel,
  visibilityLabel,
} from "@/lib/presentation";
import {
  canEditProblemByViewer,
  canViewProblemExplanation,
  getProblemPackageData,
  getOptionalCurrentUser,
  getProblemForViewer,
} from "@/lib/store";
import { getJudgeEnvironmentVersion } from "@/lib/judge-config";

interface ProblemDetailPageProps {
  params: Promise<{
    problemId: string;
  }>;
}

function hiddenExplanationMessage(explanationVisibility: "always" | "contest_end" | "private"): string {
  if (explanationVisibility === "contest_end") {
    return "解説はコンテスト終了後に公開されます。";
  }
  return "解説は現在非公開です。";
}

export default async function ProblemDetailPage({ params }: ProblemDetailPageProps) {
  const { problemId } = await params;
  const me = await getOptionalCurrentUser();
  const viewerId = me?.id ?? "guest";
  const judgeEnvironmentVersion = getJudgeEnvironmentVersion();
  const problem = getProblemForViewer(problemId, viewerId);
  if (!problem) {
    notFound();
  }

  const canEditProblem = me ? canEditProblemByViewer(problem, me.id) : false;
  const canViewExplanation = canViewProblemExplanation(problem, viewerId);
  const packageData = getProblemPackageData(problem.id);

  return (
    <div className="page">
      <section className="page-head">
        <div>
          <h1 className="page-title">{problem.title}</h1>
          <p className="page-subtitle">問題詳細・制約・解説を確認し、そのまま提出できます。</p>
        </div>
        <div className="button-row">
          <StatusBadge className={badgeClassForVisibility(problem.visibility)}>
            {visibilityLabel(problem.visibility)}
          </StatusBadge>
          <Link href={`/problems/${problem.id}/submit`} className="button">
            提出する
          </Link>
          {canEditProblem ? (
            <Link href={`/problems/${problem.id}/edit`} className="button button-secondary">
              編集
            </Link>
          ) : null}
          <Link
            href={`/reports/new?targetType=problem&targetId=${problem.id}`}
            className="button button-danger"
          >
            通報
          </Link>
        </div>
      </section>

      <section className="panel stack">
        <h2 className="panel-title">Statement</h2>
        <MarkdownBlock text={problem.statementMarkdown} />
      </section>

      <section className="grid-2">
        <article className="panel stack">
          <h2 className="panel-title">Input</h2>
          <MarkdownBlock text={problem.inputDescription} />
        </article>
        <article className="panel stack">
          <h2 className="panel-title">Output</h2>
          <MarkdownBlock text={problem.outputDescription} />
        </article>
      </section>

      <section className="grid-2">
        <article className="panel stack">
          <h2 className="panel-title">Constraints</h2>
          <MarkdownBlock text={problem.constraintsMarkdown} />
        </article>
        <article className="panel stack">
          <h2 className="panel-title">Judge Settings</h2>
          <p className="text-soft">
            Difficulty:{" "}
            <StatusBadge className={badgeClassForDifficulty(problem.difficulty)}>
              {difficultyLabel(problem.difficulty)}
            </StatusBadge>
          </p>
          <p className="text-soft">Time Limit: {problem.timeLimitMs} ms</p>
          <p className="text-soft">Memory Limit: {problem.memoryLimitMb} MB</p>
          <p className="text-soft">
            Test Case Visibility: {testCaseVisibilityLabel(problem.testCaseVisibility)}
          </p>
          <p className="text-soft">Judge Environment: {judgeEnvironmentVersion}</p>
        </article>
      </section>

      {packageData && packageData.samples.length > 0 ? (
        <section className="panel stack">
          <h2 className="panel-title">Samples</h2>
          {packageData.samples.map((sample) => (
            <article key={sample.name} className="package-case-editor stack">
              <p className="field-label">{sample.name}</p>
              <div className="form-grid">
                <div className="field">
                  <span className="field-label">Input</span>
                  <pre className="code-block">{sample.input}</pre>
                </div>
                <div className="field">
                  <span className="field-label">Output</span>
                  <pre className="code-block">{sample.output}</pre>
                </div>
              </div>
            </article>
          ))}
        </section>
      ) : null}

      <section className="panel stack">
        <h2 className="panel-title">Explanation</h2>
        <p className="text-soft">
          Explanation Visibility: {explanationVisibilityLabel(problem.explanationVisibility)}
        </p>
        {canViewExplanation ? (
          <MarkdownBlock text={problem.explanationMarkdown || "解説はまだありません。"} />
        ) : (
          <p className="badge badge-slate">{hiddenExplanationMessage(problem.explanationVisibility)}</p>
        )}
      </section>

      {problem.latestPackageSummary ? (
        <section className="panel stack">
          <h2 className="panel-title">Latest Package Validation</h2>
          <p className="text-soft">File: {problem.latestPackageSummary.fileName}</p>
          <p className="text-soft">
            Size: {problem.latestPackageSummary.zipSizeBytes} bytes / Files:{" "}
            {problem.latestPackageSummary.fileCount}
          </p>
          <p className="text-soft">
            Samples: {problem.latestPackageSummary.samplePairs} pairs / Tests:{" "}
            {problem.latestPackageSummary.testGroupCount} groups,{" "}
            {problem.latestPackageSummary.totalTestPairs} pairs
          </p>
          <p className="text-soft">Validated: {formatDate(problem.latestPackageSummary.validatedAt)}</p>
          {problem.latestPackageSummary.warnings.length > 0 ? (
            <div className="stack">
              <p className="field-label">Warnings</p>
              {problem.latestPackageSummary.warnings.map((warning) => (
                <p key={warning} className="text-soft">
                  - {warning}
                </p>
              ))}
            </div>
          ) : (
            <p className="badge">No warnings.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
