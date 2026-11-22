import Link from "next/link";
import { notFound } from "next/navigation";
import { getI18n } from "@/lib/i18n/server";
import {
  getOptionalCurrentUser,
  getProblemForViewer,
  getProblemForContestViewer,
} from "@/lib/store";
import { loadPublicBoardSamples } from "@/lib/game-public-samples";
import { loadHeuristicContestProblem } from "@/lib/heuristic-store";
import { SubmissionForm } from "@/components/submission-form";
import { HeuristicVisualizer } from "@/components/heuristic-visualizer";
import { MarkdownBlock } from "@/components/markdown-block";
import { ProblemResultLinks } from "@/components/problem-result-links";

export const dynamic = "force-dynamic";
export default async function GamePage({
  params,
  searchParams,
}: {
  params: Promise<{ problemId: string }>;
  searchParams: Promise<{ contestId?: string }>;
}) {
  const { problemId } = await params,
    { contestId } = await searchParams,
    { t } = await getI18n(),
    user = await getOptionalCurrentUser();
  let problem = contestId
    ? getProblemForContestViewer(problemId, contestId, user?.id ?? "guest")
    : getProblemForViewer(problemId, user?.id ?? "guest");
  if (!problem) notFound();
  if (contestId) {
    const fixed = await loadHeuristicContestProblem(contestId, problemId);
    if (fixed) problem = fixed.problem;
  } else problem = await loadPublicBoardSamples(problem);
  if (!problem.heuristic?.game || !problem.heuristic.board) notFound();
  const query = contestId ? `?contestId=${encodeURIComponent(contestId)}` : "";
  return (
    <div className="page">
      <section className="page-head">
        <div>
          <h1 className="page-title">{problem.title}</h1>
          <p className="page-subtitle">
            {t(
              "Test runs use only the board you provide. Official submissions are judged separately on the fixed problem revision.",
            )}
          </p>
        </div>
        <div className="button-row">
          <ProblemResultLinks problemId={problem.id} contestId={contestId} heuristic />
          <Link className="button button-secondary" href="/games">
            {t("Games")}
          </Link>
          <Link
            className="button button-secondary"
            href={`/problems/${problem.id}${query}`}
          >
            {t("Problem statement")}
          </Link>
        </div>
      </section>
      {user ? (
        <section className="panel">
          <SubmissionForm
            key={problem.id}
            problemId={problem.id}
            contestId={contestId ?? null}
            gameConfig={problem.heuristic}
            sampleInput={problem.sampleCases[0]?.input ?? ""}
          />
        </section>
      ) : (
        <section className="panel stack">
          <p>{t("Sign in to run code and submit a game bot.")}</p>
          <Link
            className="button button-primary"
            href={`/signin?callbackUrl=${encodeURIComponent(`/games/${problem.id}${query}`)}`}
          >
            {t("Sign in")}
          </Link>
        </section>
      )}
      <details className="panel stack">
        <summary>{t("Problem statement")}</summary>
        <MarkdownBlock text={problem.statementMarkdown} />
        <MarkdownBlock text={problem.inputDescription} />
        <MarkdownBlock text={problem.outputDescription} />
      </details>
      <HeuristicVisualizer
        config={problem.heuristic}
        kind="board"
        sampleInput={problem.sampleCases[0]?.input ?? ""}
        sampleOutput={problem.sampleCases[0]?.output ?? ""}
      />
    </div>
  );
}
