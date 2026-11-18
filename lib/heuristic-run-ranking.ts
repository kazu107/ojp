import { Prisma } from "@prisma/client";
import { prisma } from "./db/prisma";
import type { HeuristicConfig } from "./heuristic-config";
import { addBaseline, rankAggregates, relativeScore, scoreString, type AggregateAttempt, type ScoredCase } from "./heuristic-score";

export interface RankableRun {
  id: string;
  submissionId: string;
  userId: string;
  submittedAt: string;
  score: Prisma.Decimal | null;
}

export async function rankHeuristicRuns(config: HeuristicConfig, runs: RankableRun[]) {
  const aggregates: AggregateAttempt[] = [];
  function add(run: RankableRun, score: string | null) {
    aggregates.push({ userId: run.userId, submissionId: run.submissionId, submittedAt: run.submittedAt, score, rank: 0 });
  }
  if (config.evaluation === "absolute") {
    for (const run of runs) add(run, run.score === null ? null : scoreString(run.score));
  } else {
    // Two passes keep memory bounded by a batch of cases, not the entire standings.
    async function scan(visit: (run: RankableRun, cases: ScoredCase[]) => void) {
      for (let i = 0; i < runs.length; i += 10) {
        const batch = runs.slice(i, i + 10);
        const scores = await prisma.heuristicCaseScore.findMany({
          where: { runId: { in: batch.map(r => r.id) } },
          select: { runId: true, caseKey: true, verdict: true, rawScore: true },
        });
        const byRun = new Map<string, ScoredCase[]>();
        for (const row of scores) {
          const cases = byRun.get(row.runId) ?? [];
          cases.push({ key: row.caseKey, verdict: row.verdict, rawScore: row.rawScore === null ? null : scoreString(row.rawScore) });
          byRun.set(row.runId, cases);
        }
        for (const run of batch) visit(run, byRun.get(run.id) ?? []);
      }
    }
    const baseline = new Map<string, Prisma.Decimal>();
    await scan((_run, cases) => addBaseline(config, baseline, cases));
    await scan((run, cases) => add(run, relativeScore(config, cases, baseline)));
  }
  return rankAggregates(config, aggregates);
}
