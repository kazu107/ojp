import Link from "next/link";
import { notFound } from "next/navigation";
import { getI18n } from "@/lib/i18n/server";
import { loadHeuristicContestProblem } from "@/lib/heuristic-store";
import { formatDate, languageLabel } from "@/lib/presentation";
import { eligibleForProblemStandings, problemStandings } from "@/lib/problem-standings";
import {
  findUser, getContestStatus, getOptionalCurrentUser, getProblemForContestViewer,
  getProblemForViewer, listContestsForListView, listSubmissionsForViewer,
} from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function ProblemStandingsPage({ params, searchParams }: {
  params: Promise<{ problemId: string }>;
  searchParams: Promise<{ contestId?: string; virtualParticipationId?: string }>;
}) {
  const { problemId } = await params;
  const { contestId, virtualParticipationId } = await searchParams;
  const viewer = (await getOptionalCurrentUser())?.id ?? "guest";
  const direct = getProblemForViewer(problemId, viewer);
  const accessible = contestId ? getProblemForContestViewer(problemId, contestId, viewer) : direct;
  if (!accessible) notFound();
  const fixed = contestId ? await loadHeuristicContestProblem(contestId, problemId, { includeSamples: false }) : null;
  const problem = fixed?.problem ?? accessible;
  if (!problem.heuristic) notFound();

  const finishedPublic = new Set(listContestsForListView("guest")
    .filter(c => c.visibility === "public" && getContestStatus(c) === "ended").map(c => c.id));
  const submissions = listSubmissionsForViewer(viewer, { problemId, contestId: direct ? undefined : contestId })
    .filter(s => eligibleForProblemStandings(s, finishedPublic));
  const byId = new Map(submissions.map(s => [s.id, s]));
  const boards = await problemStandings(problemId, submissions, fixed?.revisionId);
  const { t, locale } = await getI18n();
  return <div className="page">
    <section className="page-head">
      <h1 className="page-title">{problem.title}: {t("Problem Standings")}</h1>
      <Link className="button button-secondary" href={{ pathname: `/problems/${encodeURIComponent(problemId)}`, query: contestId ? { contestId, ...(virtualParticipationId ? { virtualParticipationId } : {}) } : {} }}>{t("Back to Problem")}</Link>
    </section>
    {!boards.length ? <p className="panel empty">{t("No ranked submissions yet.")}</p> : null}
    {boards.map(board => <section key={board.revisionId} className="panel stack">
      <h2 className="panel-title">{t("Judge Revision")}: {board.revisionId.slice(0, 8)}</h2>
      <div className="meta-inline">{t(board.direction)} / {t(board.evaluation)}</div>
      <div className="table-wrap"><table className="table">
        <thead><tr>{["Rank", "User", "Score", "Language", "Submitted", "Submission"].map(label => <th key={label}>{t(label)}</th>)}</tr></thead>
        <tbody>{board.rows.map(row => <tr key={row.userId}>
          <td>{row.rank}</td><td>{findUser(row.userId)?.displayName ?? row.userId}</td>
          <td>{row.score}</td><td>{languageLabel(byId.get(row.submissionId)!.language)}</td>
          <td>{formatDate(row.submittedAt, locale)}</td>
          <td><Link className="link" href={`/submissions/${encodeURIComponent(row.submissionId)}`}>{row.submissionId}</Link></td>
        </tr>)}</tbody>
      </table></div>
    </section>)}
  </div>;
}
