import { Prisma } from "@prisma/client";
import { prisma } from "./db/prisma";
import { parseHeuristicConfig, type HeuristicConfig } from "./heuristic-config";
import { rankHeuristicRuns, type RankableRun } from "./heuristic-run-ranking";
import type { Submission } from "./types";

export function eligibleForProblemStandings(
  submission: Pick<Submission, "virtualParticipationId" | "contestId" | "status">,
  finishedPublicContests: ReadonlySet<string>,
) {
  return !submission.virtualParticipationId &&
    submission.status !== "compilation_error" && submission.status !== "cancelled" &&
    (!submission.contestId || finishedPublicContests.has(submission.contestId));
}

type Run = Pick<RankableRun, "id" | "submissionId" | "score"> & {
  revisionId: string; config: Prisma.JsonValue;
};

export async function problemStandings(
  problemId: string,
  submissions: Pick<Submission, "id" | "userId" | "submittedAt">[],
  pinnedRevision?: string,
) {
  const groups = new Map<string, { config: HeuristicConfig; runs: RankableRun[]; latest: string }>();
  for (let i = 0; i < submissions.length; i += 500) {
    const batch = submissions.slice(i, i + 500);
    const byId = new Map(batch.map(s => [s.id, s]));
    // Choose the latest evaluation before checking its status or revision:
    // an in-flight or failed rejudge must not resurrect an older score.
    const runs = await prisma.$queryRaw<Run[]>`
      SELECT id, "submissionId", "revisionId", score, config FROM (
        SELECT DISTINCT ON ("submissionId") id, "submissionId", "revisionId", score, config, status
        FROM "HeuristicRun" WHERE "problemId" = ${problemId} AND phase = 'provisional'
          AND "submissionId" IN (${Prisma.join(batch.map(s => s.id))})
        ORDER BY "submissionId", "createdAt" DESC, id DESC
      ) latest WHERE status = 'completed'`;
    for (const run of runs) {
      if (pinnedRevision && run.revisionId !== pinnedRevision) continue;
      const sub = byId.get(run.submissionId)!;
      const group = groups.get(run.revisionId) ?? {
        config: parseHeuristicConfig(run.config), runs: [], latest: sub.submittedAt,
      };
      group.runs.push({ id: run.id, submissionId: sub.id, score: run.score, userId: sub.userId, submittedAt: sub.submittedAt });
      if (group.latest < sub.submittedAt) group.latest = sub.submittedAt;
      groups.set(run.revisionId, group);
    }
  }
  const boards = [];
  for (const [revisionId, group] of [...groups].sort((a, b) => b[1].latest.localeCompare(a[1].latest) || a[0].localeCompare(b[0]))) {
    const rows = (await rankHeuristicRuns(group.config, group.runs)).filter(row => row.rank > 0);
    if (rows.length) boards.push({ revisionId, direction: group.config.direction, evaluation: group.config.evaluation, rows });
  }
  return boards;
}
