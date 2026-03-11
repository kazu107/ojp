import Link from "next/link";
import { notFound } from "next/navigation";
import { MarkdownBlock } from "@/components/markdown-block";
import { StatusBadge } from "@/components/status-badge";
import {
  badgeClassForDifficulty,
  badgeClassForVisibility,
  difficultyLabel,
  testCaseVisibilityLabel,
  visibilityLabel,
} from "@/lib/presentation";
import {
  canEditProblemByViewer,
  getProblemPackageData,
  getOptionalCurrentUser,
  getProblemForViewer,
} from "@/lib/store";
import { getJudgeEnvironmentVersion } from "@/lib/judge-config";
import { SubmissionForm } from "@/components/submission-form";

interface ProblemDetailPageProps {
  params: Promise<{
    problemId: string;
  }>;
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
  const packageData = getProblemPackageData(problem.id);
  const signInUrl = `/signin?callbackUrl=${encodeURIComponent(`/problems/${problem.id}`)}`;

  return (
    <div className="page">
      <section className="page-head">
        <div>
          <h1 className="page-title">{problem.title}</h1>
          <p className="page-subtitle">問題詳細と制約を確認し、そのまま提出できます。</p>
        </div>
        <div className="button-row">
          <StatusBadge className={badgeClassForVisibility(problem.visibility)}>
            {visibilityLabel(problem.visibility)}
          </StatusBadge>
          <Link href={`/problems/${problem.id}/submit`} className="button">
            提出する
          </Link>
          <Link href={`/problems/${problem.id}/explanation`} className="button button-secondary">
            解説
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
              {sample.description ? (
                <p className="text-soft">{sample.description}</p>
              ) : null}
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
        <h2 className="panel-title">Submit</h2>
        {me ? (
          <>
            <p className="text-soft">
              このページの下から直接提出できます。提出後は非同期ジャッジされ、提出詳細で結果を確認できます。
            </p>
            <SubmissionForm problemId={problem.id} />
          </>
        ) : (
          <>
            <p className="text-soft">
              提出するにはログインが必要です。ログイン後、この問題ページに戻ります。
            </p>
            <div className="button-row">
              <Link href={signInUrl} className="button">
                Sign In to Submit
              </Link>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
