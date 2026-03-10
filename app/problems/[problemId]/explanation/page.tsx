import Link from "next/link";
import { notFound } from "next/navigation";
import { MarkdownBlock } from "@/components/markdown-block";
import { StatusBadge } from "@/components/status-badge";
import {
  badgeClassForDifficulty,
  difficultyLabel,
  explanationVisibilityLabel,
} from "@/lib/presentation";
import {
  canEditProblemByViewer,
  canViewProblemExplanation,
  getOptionalCurrentUser,
  getProblemForViewer,
} from "@/lib/store";

interface ProblemExplanationPageProps {
  params: Promise<{
    problemId: string;
  }>;
}

function hiddenExplanationMessage(
  explanationVisibility: "always" | "contest_end" | "private",
): string {
  if (explanationVisibility === "contest_end") {
    return "解説はコンテスト終了後に公開されます。";
  }
  return "解説は現在非公開です。";
}

export default async function ProblemExplanationPage({
  params,
}: ProblemExplanationPageProps) {
  const { problemId } = await params;
  const me = await getOptionalCurrentUser();
  const viewerId = me?.id ?? "guest";
  const problem = getProblemForViewer(problemId, viewerId);
  if (!problem) {
    notFound();
  }

  const canEditProblem = me ? canEditProblemByViewer(problem, me.id) : false;
  const canViewExplanation = canViewProblemExplanation(problem, viewerId);

  return (
    <div className="page">
      <section className="page-head">
        <div>
          <h1 className="page-title">Explanation: {problem.title}</h1>
          <p className="page-subtitle">解説専用ページです。公開条件に応じて内容が表示されます。</p>
        </div>
        <div className="button-row">
          <Link href={`/problems/${problem.id}`} className="button button-secondary">
            問題へ戻る
          </Link>
          <Link href={`/problems/${problem.id}/submit`} className="button">
            提出する
          </Link>
          {canEditProblem ? (
            <Link href={`/problems/${problem.id}/edit`} className="button button-secondary">
              編集
            </Link>
          ) : null}
        </div>
      </section>

      <section className="panel stack">
        <div className="meta-inline">
          <span className="text-soft">Explanation Visibility: {explanationVisibilityLabel(problem.explanationVisibility)}</span>
          <StatusBadge className={badgeClassForDifficulty(problem.difficulty)}>
            {difficultyLabel(problem.difficulty)}
          </StatusBadge>
        </div>
        {canViewExplanation ? (
          <MarkdownBlock text={problem.explanationMarkdown || "解説はまだありません。"} />
        ) : (
          <p className="badge badge-slate">{hiddenExplanationMessage(problem.explanationVisibility)}</p>
        )}
      </section>
    </div>
  );
}
