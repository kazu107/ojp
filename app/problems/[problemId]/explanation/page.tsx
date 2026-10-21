
import { getI18n } from "@/lib/i18n/server";
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
  getProblemForContestViewer,
} from "@/lib/store";

interface ProblemExplanationPageProps {
  params: Promise<{
    problemId: string;
  }>;
  searchParams:Promise<{contestId?:string;virtualParticipationId?:string}>;
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
  searchParams,
}: ProblemExplanationPageProps) {
  const { t } = await getI18n();
  const { problemId } = await params;
  const {contestId,virtualParticipationId}=await searchParams;
  const contextQuery=contestId?`?contestId=${encodeURIComponent(contestId)}${virtualParticipationId?`&virtualParticipationId=${encodeURIComponent(virtualParticipationId)}`:""}`:"";
  const me = await getOptionalCurrentUser();
  const viewerId = me?.id ?? "guest";
  const problem = contestId?getProblemForContestViewer(problemId,contestId,viewerId):getProblemForViewer(problemId, viewerId);
  if (!problem) {
    notFound();
  }

  const canEditProblem = me ? canEditProblemByViewer(problem, me.id) : false;
  const canViewExplanation = canViewProblemExplanation(problem, viewerId);

  return (
    <div className="page">
      <section className="page-head">
        <div>
          <h1 className="page-title">{t("Explanation: ")}{problem.title}</h1>
          <p className="page-subtitle">{t("解説専用ページです。公開条件に応じて内容が表示されます。")}</p>
        </div>
        <div className="button-row">
          <Link href={`/problems/${problem.id}${contextQuery}`} className="button button-secondary">
            {t("問題へ戻る")}</Link>
          <Link href={`/problems/${problem.id}/submit${contextQuery}`} className="button">
            {t("提出する")}</Link>
          {canEditProblem ? (
            <Link href={`/problems/${problem.id}/edit`} className="button button-secondary">
              {t("編集")}</Link>
          ) : null}
        </div>
      </section>

      <section className="panel stack">
        <div className="meta-inline">
          <span className="text-soft">{t("Explanation Visibility: ")}{t(explanationVisibilityLabel(problem.explanationVisibility))}</span>
          <StatusBadge className={badgeClassForDifficulty(problem.difficulty)}>
            {t(difficultyLabel(problem.difficulty))}
          </StatusBadge>
        </div>
        {canViewExplanation ? (
          <MarkdownBlock text={problem.explanationMarkdown || t("解説はまだありません。")} />
        ) : (
          <p className="badge badge-slate">{t(hiddenExplanationMessage(problem.explanationVisibility))}</p>
        )}
      </section>
    </div>
  );
}
