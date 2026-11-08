import { Prisma } from "@prisma/client";
import type { HeuristicConfig } from "./heuristic-config";
const Decimal = Prisma.Decimal;
Decimal.set({ precision: 60, rounding: Decimal.ROUND_HALF_UP });
export const SCORE_SCALE = 12;
export function scoreDecimal(raw: unknown): Prisma.Decimal {
  if (typeof raw !== "string" || !/^(0|[1-9]\d{0,23})(\.\d{1,12})?$/.test(raw))
    throw new Error(
      "Score must be a nonnegative decimal string (24 integer / 12 fractional digits)",
    );
  return new Decimal(raw);
}
export function scoreString(value: Prisma.Decimal): string {
  return value.toFixed(SCORE_SCALE).replace(/\.?0+$/, "") || "0";
}
export interface ScoredCase {
  key: string;
  verdict: string;
  rawScore: string | null;
}
export interface ScoredAttempt {
  id: string;
  userId: string;
  submittedAt: string;
  cases: ScoredCase[];
}
export function parseScorerResult(text: string): {
  valid: boolean;
  score: string | null;
  diagnostic: string;
} {
  if (text.length > 16384) throw new Error("Scorer response exceeds 16 KiB");
  const result = JSON.parse(text);
  if (!result || result.version !== 1 || typeof result.valid !== "boolean")
    throw new Error("Invalid scorer protocol");
  if (result.message !== undefined && typeof result.message !== "string")
    throw new Error("Invalid scorer message");
  return {
    valid: result.valid,
    score: result.valid ? scoreString(scoreDecimal(result.score)) : null,
    diagnostic: String(result.message ?? "").slice(0, 4000),
  };
}
export function absoluteScore(
  config: HeuristicConfig,
  cases: ScoredCase[],
): string | null {
  if (!cases.length || cases.some((c) => c.verdict === "internal_error"))
    return null;
  const failed = cases.some(
    (c) => c.verdict !== "accepted" || c.rawScore === null,
  );
  if (
    failed &&
    (config.failurePolicy === "submission_zero" ||
      config.direction === "minimize")
  )
    return null;
  const sum = cases.reduce(
    (n, c) =>
      n.plus(
        c.verdict === "accepted" && c.rawScore !== null
          ? scoreDecimal(c.rawScore)
          : 0,
      ),
    new Decimal(0),
  );
  return scoreString(config.aggregate === "mean" ? sum.div(cases.length) : sum);
}
export function rankHeuristicAttempts(
  config: HeuristicConfig,
  attempts: ScoredAttempt[],
  selection: "best" | "last",
) {
  const latest = new Map<string, ScoredAttempt>();
  for (const a of [...attempts].sort(
    (a, b) =>
      a.submittedAt.localeCompare(b.submittedAt) || a.id.localeCompare(b.id),
  ))
    latest.set(a.userId, a);
  const candidates = selection === "last" ? [...latest.values()] : attempts;
  const baseline = new Map<string, Prisma.Decimal>();
  for (const a of candidates)
    for (const c of a.cases) {
      if (c.verdict !== "accepted" || c.rawScore === null) continue;
      if (
        config.failurePolicy === "submission_zero" &&
        a.cases.some((c) => c.verdict !== "accepted")
      )
        continue;
      const score = scoreDecimal(c.rawScore),
        current = baseline.get(c.key);
      if (
        !current ||
        (config.direction === "maximize"
          ? score.gt(current)
          : score.lt(current))
      )
        baseline.set(c.key, score);
    }
  const rows = candidates.map((a) => {
    let score = absoluteScore(config, a.cases);
    if (
      config.evaluation === "relative" &&
      a.cases.length &&
      !a.cases.some((c) => c.verdict === "internal_error")
    ) {
      const invalid =
        config.failurePolicy === "submission_zero" &&
        a.cases.some((c) => c.verdict !== "accepted");
      const total = a.cases.reduce((sum, c) => {
        if (invalid || c.verdict !== "accepted" || c.rawScore === null)
          return sum;
        const own = scoreDecimal(c.rawScore),
          best = baseline.get(c.key);
        if (!best) return sum;
        const ratio = best.isZero()
          ? config.direction === "maximize" || own.isZero()
            ? new Decimal(1)
            : new Decimal(0)
          : config.direction === "maximize"
            ? own.div(best)
            : best.div(own);
        return sum.plus(ratio.times(1_000_000_000).toDecimalPlaces(0));
      }, new Decimal(0));
      score = invalid
        ? null
        : scoreString(
            config.aggregate === "mean" ? total.div(a.cases.length) : total,
          );
    }
    return {
      userId: a.userId,
      submissionId: a.id,
      submittedAt: a.submittedAt,
      score,
      rank: 0,
    };
  });
  return rankAggregates(config, rows);
}

export interface AggregateAttempt {
  userId: string;
  submissionId: string;
  submittedAt: string;
  score: string | null;
  rank: number;
}
export function rankAggregates(
  config: HeuristicConfig,
  rows: AggregateAttempt[],
) {
  const compare = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
    a.score === null
      ? b.score === null
        ? 0
        : 1
      : b.score === null
        ? -1
        : new Decimal(a.score).cmp(new Decimal(b.score)) *
          (config.evaluation === "relative" || config.direction === "maximize"
            ? -1
            : 1);
  rows.sort(
    (a, b) =>
      compare(a, b) ||
      a.submittedAt.localeCompare(b.submittedAt) ||
      a.submissionId.localeCompare(b.submissionId),
  );
  const seen = new Set<string>();
  const winners = rows.filter((row) => {
    if (seen.has(row.userId)) return false;
    seen.add(row.userId);
    return true;
  });
  let previous: (typeof rows)[number] | undefined;
  for (const [i, row] of winners.entries()) {
    row.rank =
      row.score === null
        ? 0
        : previous && compare(previous, row) === 0
          ? previous.rank
          : i + 1;
    previous = row;
  }
  return winners;
}

export function addBaseline(
  config: HeuristicConfig,
  baseline: Map<string, Prisma.Decimal>,
  cases: ScoredCase[],
) {
  if (
    config.failurePolicy === "submission_zero" &&
    cases.some((c) => c.verdict !== "accepted")
  )
    return;
  for (const c of cases) {
    if (c.verdict !== "accepted" || c.rawScore === null) continue;
    const value = scoreDecimal(c.rawScore),
      old = baseline.get(c.key);
    if (
      !old ||
      (config.direction === "maximize" ? value.gt(old) : value.lt(old))
    )
      baseline.set(c.key, value);
  }
}
export function relativeScore(
  config: HeuristicConfig,
  cases: ScoredCase[],
  baseline: Map<string, Prisma.Decimal>,
): string | null {
  if (
    !cases.length ||
    cases.some((c) => c.verdict === "internal_error") ||
    (config.failurePolicy === "submission_zero" &&
      cases.some((c) => c.verdict !== "accepted"))
  )
    return null;
  const total = cases.reduce((sum, c) => {
    if (c.verdict !== "accepted" || c.rawScore === null) return sum;
    const own = scoreDecimal(c.rawScore),
      best = baseline.get(c.key);
    if (!best) return sum;
    const ratio = best.isZero()
      ? new Decimal(config.direction === "maximize" || own.isZero() ? 1 : 0)
      : config.direction === "maximize"
        ? own.div(best)
        : best.div(own);
    return sum.plus(ratio.times(1000000000).toDecimalPlaces(0));
  }, new Decimal(0));
  return scoreString(
    config.aggregate === "mean" ? total.div(cases.length) : total,
  );
}
