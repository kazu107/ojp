import { scoreString } from "@/lib/heuristic-score";
import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import { getI18n } from "@/lib/i18n/server";
import { parseHeuristicConfig } from "@/lib/heuristic-config";
import type { Prisma } from "@prisma/client";
export async function HeuristicPersonalBest({
  problemId,
  submissionIds,
}: {
  problemId: string;
  submissionIds: string[];
}) {
  if (!submissionIds.length) return null;
  const { t } = await getI18n();
  type BestRow = Prisma.HeuristicRunGetPayload<{
    select: {
      id: true;
      submissionId: true;
      revisionId: true;
      score: true;
      config: true;
    };
  }>;
  const best = new Map<string, BestRow>();
  let cursor: string | undefined;
  for (;;) {
    const runs = await prisma.heuristicRun.findMany({
      where: {
        problemId,
        submissionId: { in: submissionIds },
        phase: "provisional",
        status: "completed",
        score: { not: null },
      },
      select: {
        id: true,
        submissionId: true,
        revisionId: true,
        score: true,
        config: true,
      },
      orderBy: { id: "asc" },
      take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const run of runs) {
      const current = best.get(run.revisionId);
      if (
        !current ||
        (parseHeuristicConfig(run.config).direction === "maximize"
          ? run.score!.gt(current.score!)
          : run.score!.lt(current.score!))
      )
        best.set(run.revisionId, run);
    }
    if (runs.length < 500) break;
    cursor = runs[runs.length - 1].id;
  }
  return (
    <section className="panel stack">
      <h2>{t("My Best Scores by Revision")}</h2>
      {[...best.values()].map((run) => (
        <p key={run.revisionId}>
          {run.revisionId.slice(0, 8)}:{" "}
          <Link className="link" href={`/submissions/${run.submissionId}`}>
            {scoreString(run.score!)}
          </Link>
        </p>
      ))}
    </section>
  );
}
