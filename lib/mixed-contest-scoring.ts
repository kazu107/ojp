import { Prisma } from "@prisma/client";
import { calculateStandings, compareStandings } from "./contest";
import type { Contest, ScoreboardProblemCell, Submission } from "./types";

// Relative scoring in mean mode gives 0..1e9, regardless of case count.
export function normalizedContestPoints(meanRelative: string | null, maximum: number): number {
  return meanRelative === null ? 0 : new Prisma.Decimal(meanRelative)
    .times(maximum).div(1_000_000_000).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber();
}

export function combineMixedStandings(
  contest: Contest,
  submissions: Submission[],
  numericProblemIds: ReadonlySet<string>,
  numericCells: ReadonlyMap<string, ScoreboardProblemCell[]>,
) {
  const normalProblems = contest.problems.filter(p => !numericProblemIds.has(p.problemId));
  const rows = calculateStandings({ ...contest, problems: normalProblems }, submissions);
  for (const row of rows) {
    const cells = new Map([...row.cells, ...(numericCells.get(row.userId) ?? [])].map(cell => [cell.label, cell]));
    row.cells = [...contest.problems].sort((a,b) => a.orderIndex - b.orderIndex).map(p => cells.get(p.label) ?? {
      label: p.label, score: 0, normalizedHeuristic: true, acceptedAt: null, wrongSubmissions: 0,
    });
    row.totalScore = Math.round(row.cells.reduce((sum, cell) => sum + cell.score, 0) * 100) / 100;
    for (const cell of row.cells) {
      if (cell.acceptedAt && (!row.lastAcceptedAt || cell.acceptedAt > row.lastAcceptedAt))
        row.lastAcceptedAt = cell.acceptedAt;
    }
  }
  rows.sort((a,b) => compareStandings(a,b) || a.userId.localeCompare(b.userId));
  rows.forEach((row,i) => { row.rank = i && compareStandings(rows[i-1],row) === 0 ? rows[i-1].rank : i + 1; });
  return rows;
}
