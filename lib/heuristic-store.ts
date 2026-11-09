import { randomUUID } from "node:crypto";
import { WorkspaceError } from "./workspace-error";
import { Prisma, type HeuristicRun } from "@prisma/client";
import { prisma } from "./db/prisma";
import { parseHeuristicConfig } from "./heuristic-config";
import {
  absoluteScore,
  rankAggregates,
  addBaseline,
  relativeScore,
  scoreString,
  type ScoredCase,
  type AggregateAttempt,
} from "./heuristic-score";
import { revisionById } from "./problem-revisions";
import { createLazyProblemPackageSourceFromStorageRef } from "./problem-package-lazy";
import { executePackageJudge } from "./judge-runtime";
import type {
  Contest,
  Submission,
  SubmissionStatus,
  ScoreboardRow,
  Problem,
} from "./types";

const publicSamples = new Map<string, Problem["sampleCases"]>();
export async function assertHeuristicAvailable() {
  try {
    await prisma.$queryRaw`SELECT id FROM "HeuristicRun" LIMIT 0`;
  } catch {
    throw new WorkspaceError(
      "Heuristic database setup is required. Run npm run db:heuristic.",
    );
  }
}
export async function isHeuristicRevision(problemId: string, id: string) {
  const rows = await prisma.$queryRaw<
    Array<{ numeric: boolean }>
  >`SELECT (snapshot#>'{problem,heuristic}') IS NOT NULL AND (snapshot#>'{problem,heuristic}')<>'null'::jsonb AS numeric FROM "ProblemRevision" WHERE id=${id} AND "problemId"=${problemId}`;
  return rows[0]?.numeric ?? false;
}
export async function loadHeuristicContestProblem(
  contestId: string,
  problemId: string,
) {
  const settings = await prisma.heuristicContest.findUnique({
    where: { contestId },
  });
  const revisionId = (
    settings?.revisions as Record<string, string> | undefined
  )?.[problemId];
  if (!revisionId) return null;
  const snapshot = await revisionById(problemId, revisionId);
  if (!snapshot) throw new Error("Pinned contest revision unavailable");
  const problem = { ...snapshot.problem };
  if (snapshot.storageRef && !problem.sampleCases.length) {
    const key = snapshot.storageRef.key;
    const cached = publicSamples.get(key);
    if (cached) problem.sampleCases = cached;
    else {
      const source = await createLazyProblemPackageSourceFromStorageRef({
        ref: snapshot.storageRef,
        fileName: "package.zip",
      });
      try {
        problem.sampleCases = source.manifest.sampleCases;
        if (JSON.stringify(problem.sampleCases).length < 524288) {
          if (publicSamples.size >= 8)
            publicSamples.delete(publicSamples.keys().next().value!);
          publicSamples.set(key, problem.sampleCases);
        }
      } finally {
        await source.cleanup();
      }
    }
  }
  return { problem, tags: snapshot.tags };
}

export async function enqueueHeuristicRun(
  submission: Submission,
  phase: "provisional" | "system" = "provisional",
  evaluationId = "initial",
) {
  const revisionId = submission.judgeRevisionId ?? submission.problemRevisionId;
  if (!revisionId)
    throw new Error("A pinned revision is required for heuristic judging");
  const revision = await revisionById(submission.problemId, revisionId);
  if (!revision?.problem.heuristic)
    throw new Error("The pinned revision has no heuristic configuration");
  const config = parseHeuristicConfig(revision.problem.heuristic);
  if (phase === "system" && !config.finalGroups.length)
    throw new Error("System test groups are not configured");
  return prisma
    .$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`heuristic-enqueue:${submission.id}:${phase}`}))::text`;
      const existing = await tx.heuristicRun.findUnique({
        where: {
          submissionId_phase_evaluationId: {
            submissionId: submission.id,
            phase,
            evaluationId,
          },
        },
      });
      if (existing) {
        if (phase === "system" && existing.status === "failed") {
          await tx.heuristicCaseScore.deleteMany({
            where: { runId: existing.id, verdict: "internal_error" },
          });
          return tx.heuristicRun.update({
            where: { id: existing.id },
            data: {
              status: "queued",
              score: null,
              error: null,
              finishedAt: null,
              token: null,
              leaseUntil: null,
            },
          });
        }
        return existing;
      }
      if (phase === "provisional")
        await tx.heuristicRun.updateMany({
          where: {
            submissionId: submission.id,
            phase,
            status: { in: ["queued", "running"] },
          },
          data: { status: "superseded", token: null },
        });
      return tx.heuristicRun.create({
        data: {
          id: randomUUID(),
          submissionId: submission.id,
          problemId: submission.problemId,
          revisionId,
          evaluationId,
          phase,
          status: "queued",
          config: { ...config, seeds: {} } as unknown as Prisma.InputJsonValue,
          sourceCode: submission.sourceCode,
          language: submission.language,
        },
      });
    })
    .catch(() => {
      throw new WorkspaceError(
        "Unable to queue heuristic judging. Check database setup and retry.",
      );
    });
}

async function fenced<T>(
  run: HeuristicRun,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      Array<{ id: string }>
    >`UPDATE "HeuristicRun" SET "leaseUntil"=NOW()+INTERVAL '120 seconds' WHERE id=${run.id} AND token=${run.token} AND status='running' AND "leaseUntil">NOW() RETURNING id`;
    if (!rows.length) throw new Error("Heuristic lease lost");
    return fn(tx);
  });
}

export async function workOneHeuristicRun(): Promise<boolean> {
  const token = randomUUID();
  const rows = await prisma.$queryRaw<
    HeuristicRun[]
  >`UPDATE "HeuristicRun" SET status='running',token=${token},"leaseUntil"=NOW()+INTERVAL '120 seconds' WHERE id=(SELECT id FROM "HeuristicRun" WHERE status='queued' OR (status='running' AND "leaseUntil"<NOW()) ORDER BY "createdAt",id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`;
  const run = rows[0];
  if (!run) return false;
  const timer = setInterval(() => {
    void prisma.heuristicRun
      .updateMany({
        where: {
          id: run.id,
          token,
          status: "running",
          leaseUntil: { gt: new Date() },
        },
        data: { leaseUntil: new Date(Date.now() + 120000) },
      })
      .catch(() => {});
  }, 20000);
  let source:
    | Awaited<ReturnType<typeof createLazyProblemPackageSourceFromStorageRef>>
    | undefined;
  try {
    const revision = await revisionById(run.problemId, run.revisionId);
    if (!revision) throw new Error("Pinned revision unavailable");
    const config = parseHeuristicConfig(run.config);
    if (revision.storageRef)
      source = await createLazyProblemPackageSourceFromStorageRef({
        ref: revision.storageRef,
        fileName: "package.zip",
      });
    const groups =
      source?.groups ??
      revision.inlinePackage?.groups.map((g) => ({
        ...g,
        caseNames: g.tests.map((c) => c.name),
      })) ??
      [];
    const ordered = groups
      .filter(
        (g) => config.finalGroups.includes(g.name) === (run.phase === "system"),
      )
      .flatMap((g) =>
        g.caseNames.map((name) => ({
          group: g.name,
          name,
          key: `${g.name}/${name}`,
        })),
      );
    await fenced(run, (tx) =>
      tx.heuristicRun.update({
        where: { id: run.id },
        data: {
          config: {
            ...config,
            expectedGroups: groups
              .filter(
                (g) =>
                  config.finalGroups.includes(g.name) ===
                  (run.phase === "system"),
              )
              .map((g) => ({ name: g.name, count: g.caseNames.length })),
          } as unknown as Prisma.InputJsonValue,
        },
      }),
    );
    const saved = await prisma.heuristicCaseScore.findMany({
      where: { runId: run.id },
    });
    const existing: Submission["testResults"] = [];
    for (const c of ordered) {
      const row = saved.find((r) => r.caseKey === c.key);
      if (!row) continue;
      existing.push({
        id: `${run.id}:${row.caseKey}`,
        groupName: row.groupName,
        testCaseName: row.caseName,
        verdict: row.verdict as SubmissionStatus,
        timeMs: row.timeMs,
        memoryKb: row.memoryKb,
        message: "",
        rawScore: row.rawScore ? scoreString(row.rawScore) : null,
        scorerDiagnostic: row.diagnostic,
      });
    }
    const persistCase = async (
      tx: Prisma.TransactionClient,
      result: Submission["testResults"][number],
    ) => {
      const caseKey = `${result.groupName}/${result.testCaseName}`;
      const data = {
        groupName: result.groupName,
        caseName: result.testCaseName,
        verdict: result.verdict,
        rawScore: result.rawScore ?? null,
        timeMs: result.timeMs,
        memoryKb: result.memoryKb,
        diagnostic: (result.scorerDiagnostic ?? result.message).slice(0, 4000),
      };
      await tx.heuristicCaseScore.upsert({
        where: { runId_caseKey: { runId: run.id, caseKey } },
        create: { runId: run.id, caseKey, ...data },
        update: data,
      });
    };
    const judged = await executePackageJudge({
      sourceCode: run.sourceCode,
      language: run.language,
      timeLimitMs: revision.problem.timeLimitMs,
      memoryLimitMb: revision.problem.memoryLimitMb,
      phase: run.phase as "provisional" | "system",
      packageSource: source,
      packageData: revision.inlinePackage ?? undefined,
      existingResults: existing,
      nextTestResultId: randomUUID,
      onPhaseChange: async (status) => {
        await fenced(run, async (tx) => {
          if (run.phase === "provisional")
            await tx.submissionRuntimeState.updateMany({
              where: { submissionId: run.submissionId },
              data: {
                status,
                judgeStartedAt: new Date(run.createdAt),
                judgeEnvironmentVersion: "heuristic-v1",
              },
            });
        });
      },
      onTestResult: async ({ result, totalTimeMs, peakMemoryKb }) => {
        await fenced(run, async (tx) => {
          await persistCase(tx, result);
          if (run.phase === "provisional")
            await tx.submissionRuntimeState.updateMany({
              where: { submissionId: run.submissionId },
              data: { totalTimeMs, peakMemoryKb },
            });
        });
      },
    });
    await fenced(run, async (tx) => {
      for (const result of judged.testResults) await persistCase(tx, result);
      const score = absoluteScore(
        config,
        judged.testResults.map((c) => ({
          key: `${c.groupName}/${c.testCaseName}`,
          verdict: c.verdict,
          rawScore: c.rawScore ?? null,
        })),
      );
      await tx.heuristicRun.update({
        where: { id: run.id },
        data: {
          status: judged.status === "internal_error" ? "failed" : "completed",
          score,
          finishedAt: new Date(),
          token: null,
          leaseUntil: null,
        },
      });
      if (run.phase === "provisional") {
        await tx.submissionRuntimeTestResult.deleteMany({
          where: { submissionId: run.submissionId },
        });
        await tx.submissionRuntimeTestResult.createMany({
          data: judged.testResults.map((c, i) => ({
            id: randomUUID(),
            submissionId: run.submissionId,
            orderIndex: i,
            groupName: c.groupName,
            testCaseName: c.testCaseName,
            verdict: c.verdict,
            timeMs: c.timeMs,
            memoryKb: c.memoryKb,
            message:
              c.verdict === "accepted" ? "Valid solution" : "Evaluation failed",
          })),
        });
        await tx.submissionRuntimeState.updateMany({
          where: { submissionId: run.submissionId },
          data: {
            status: judged.status,
            score: 0,
            totalTimeMs: judged.totalTimeMs,
            peakMemoryKb: judged.peakMemoryKb,
            judgedAt: new Date(),
            judgeEnvironmentVersion: "heuristic-v1",
          },
        });
      }
    });
  } catch (error) {
    try {
      await fenced(run, async (tx) => {
        await tx.heuristicRun.update({
          where: { id: run.id },
          data: {
            status: "failed",
            error: String(
              error instanceof Error ? error.message : "Judge failed",
            ).slice(0, 2000),
            finishedAt: new Date(),
            token: null,
          },
        });
        if (run.phase === "provisional")
          await tx.submissionRuntimeState.updateMany({
            where: { submissionId: run.submissionId },
            data: { status: "internal_error", judgedAt: new Date() },
          });
      });
    } catch {
      /* A stale worker cannot publish or fail a reclaimed run. */
    }
  } finally {
    clearInterval(timer);
    await source?.cleanup();
  }
  return true;
}

export async function heuristicStandings(
  contest: Contest,
  submissions: Submission[],
) {
  const settings = await prisma.heuristicContest.findUnique({
    where: { contestId: contest.id },
  });
  if (!settings)
    return {
      rows: [] as ScoreboardRow[],
      state: "provisional",
      selected: [] as string[],
    };
  const official = submissions.filter(
    (s) =>
      s.contestId === contest.id &&
      !s.virtualParticipationId &&
      contest.participantUserIds.includes(s.userId) &&
      Date.parse(s.submittedAt) >= Date.parse(contest.startAt) &&
      Date.parse(s.submittedAt) < Date.parse(contest.endAt) &&
      !["compilation_error", "cancelled"].includes(s.status),
  );
  const all = await prisma.heuristicRun.findMany({
    where: {
      submissionId: { in: official.map((s) => s.id) },
      phase: settings.evaluationId ? "system" : "provisional",
      ...(settings.evaluationId ? { evaluationId: settings.evaluationId } : {}),
    },
    select: {
      id: true,
      submissionId: true,
      problemId: true,
      revisionId: true,
      status: true,
      score: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const finals = settings.finalSubmissionIds as string[] | null;
  const finalReady =
    !!settings.evaluationId &&
    !!finals &&
    finals.length === all.length &&
    all.every((r) => r.status === "completed");
  if (finalReady && !settings.finalizedAt)
    await prisma.heuristicContest.update({
      where: { contestId: contest.id },
      data: { finalizedAt: new Date() },
    });
  const runs =
    settings.evaluationId && !finalReady
      ? await prisma.heuristicRun.findMany({
          where: {
            submissionId: { in: official.map((s) => s.id) },
            phase: "provisional",
          },
          select: {
            id: true,
            submissionId: true,
            problemId: true,
            revisionId: true,
            status: true,
            score: true,
            createdAt: true,
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        })
      : all;
  const ids = new Set<string>();
  const unique = runs.filter((r) => {
    if (ids.has(r.submissionId)) return false;
    ids.add(r.submissionId);
    return r.status === "completed";
  });
  const selected: string[] = [];
  const totals = new Map<string, Prisma.Decimal>();
  const cells = new Map<string, ScoreboardRow["cells"]>();
  for (const problem of contest.problems) {
    const revisionIds = settings.revisions as Record<string, string>;
    const revision = await revisionById(
      problem.problemId,
      revisionIds[problem.problemId],
    );
    if (!revision?.problem.heuristic) continue;
    const config = parseHeuristicConfig(revision.problem.heuristic);
    let candidates = unique.filter(
      (r) =>
        r.problemId === problem.problemId &&
        r.revisionId === revisionIds[problem.problemId],
    );
    if (finalReady || settings.selection === "last") {
      const latest = new Map<string, (typeof candidates)[number]>();
      for (const run of candidates) {
        const sub = official.find((s) => s.id === run.submissionId)!;
        const old = latest.get(sub.userId);
        const previous = old
          ? official.find((s) => s.id === old.submissionId)
          : null;
        if (
          !previous ||
          sub.submittedAt > previous.submittedAt ||
          (sub.submittedAt === previous.submittedAt && sub.id > previous.id)
        )
          latest.set(sub.userId, run);
      }
      candidates = [...latest.values()];
    }
    const baseline = new Map<string, Prisma.Decimal>();
    async function scan(
      visit: (run: (typeof candidates)[number], cases: ScoredCase[]) => void,
    ) {
      for (let i = 0; i < candidates.length; i += 10) {
        const batch = candidates.slice(i, i + 10);
        const scores = await prisma.heuristicCaseScore.findMany({
          where: { runId: { in: batch.map((r) => r.id) } },
          select: { runId: true, caseKey: true, verdict: true, rawScore: true },
        });
        for (const run of batch)
          visit(
            run,
            scores
              .filter((c) => c.runId === run.id)
              .map((c) => ({
                key: c.caseKey,
                verdict: c.verdict,
                rawScore: c.rawScore ? scoreString(c.rawScore) : null,
              })),
          );
      }
    }
    const aggregates: AggregateAttempt[] = [];
    const add = (run: (typeof candidates)[number], score: string | null) => {
      const sub = official.find((s) => s.id === run.submissionId)!;
      aggregates.push({
        userId: sub.userId,
        submissionId: sub.id,
        submittedAt: sub.submittedAt,
        score,
        rank: 0,
      });
    };
    if (config.evaluation === "relative") {
      await scan((_run, cases) => addBaseline(config, baseline, cases));
      await scan((run, cases) =>
        add(run, relativeScore(config, cases, baseline)),
      );
    } else
      for (const run of candidates)
        add(run, run.score ? scoreString(run.score) : null);
    const ranked = rankAggregates(config, aggregates);
    for (const row of ranked) {
      selected.push(row.submissionId);
      const normalized =
        row.score === null
          ? null
          : new Prisma.Decimal(row.score)
              .times(problem.score)
              .times(
                config.evaluation === "absolute" &&
                  config.direction === "minimize"
                  ? -1
                  : 1,
              );
      if (normalized)
        totals.set(
          row.userId,
          (totals.get(row.userId) ?? new Prisma.Decimal(0)).plus(normalized),
        );
      const entries = cells.get(row.userId) ?? [];
      entries.push({
        label: problem.label,
        score: 0,
        heuristicScore: row.score,
        acceptedAt: row.submittedAt,
        wrongSubmissions: 0,
      });
      cells.set(row.userId, entries);
    }
  }
  // Homogeneous scoring is required; missing/invalid problems never win a minimization contest.
  const rows = contest.participantUserIds.map((userId) => ({
    userId,
    rank: 0,
    totalScore: 0,
    penalty: 0,
    lastAcceptedAt: null,
    heuristicScore:
      cells.get(userId)?.length === contest.problems.length &&
      cells.get(userId)!.every((c) => c.heuristicScore !== null)
        ? scoreString(totals.get(userId)!.abs())
        : null,
    cells: cells.get(userId) ?? [],
  }));
  rows.sort((a, b) =>
    a.heuristicScore === null
      ? b.heuristicScore === null
        ? a.userId.localeCompare(b.userId)
        : 1
      : b.heuristicScore === null
        ? -1
        : totals.get(b.userId)!.cmp(totals.get(a.userId)!) ||
          a.userId.localeCompare(b.userId),
  );
  rows.forEach((row, i) => {
    row.rank =
      row.heuristicScore === null
        ? 0
        : i && row.heuristicScore === rows[i - 1].heuristicScore
          ? rows[i - 1].rank
          : i + 1;
  });
  return {
    rows,
    state: settings.evaluationId
      ? finalReady
        ? "final"
        : "system_pending"
      : "provisional",
    selected,
  };
}

export async function startHeuristicSystemTest(
  contest: Contest,
  submissions: Submission[],
) {
  if (Date.now() < Date.parse(contest.endAt))
    throw new Error("System tests can start only after the contest ends");
  const current = await prisma.heuristicContest.findUnique({
    where: { contestId: contest.id },
  });
  if (!current) throw new Error("Not a heuristic contest");
  for (const p of contest.problems) {
    const revision = await revisionById(
      p.problemId,
      (current.revisions as Record<string, string>)[p.problemId],
    );
    if (!revision?.problem.heuristic?.finalGroups.length)
      throw new Error(
        "Every heuristic problem needs system test groups before finalizing",
      );
  }
  if (current.evaluationId) {
    for (const id of (current.finalSubmissionIds as string[]) ?? []) {
      const submission = submissions.find((s) => s.id === id);
      if (!submission) throw new Error("A frozen submission is unavailable");
      await enqueueHeuristicRun(submission, "system", current.evaluationId);
    }
    return current;
  }
  const candidates = submissions.filter(
    (s) =>
      s.contestId === contest.id &&
      !s.virtualParticipationId &&
      Date.parse(s.submittedAt) < Date.parse(contest.endAt),
  );
  if (
    candidates.some((s) =>
      [
        "pending",
        "queued",
        "compiling",
        "running",
        "judging",
        "internal_error",
      ].includes(s.status),
    )
  )
    throw new Error(
      "Resolve pending judgments and internal errors before starting system tests",
    );
  const board = await heuristicStandings(contest, submissions);
  const evaluationId = randomUUID();
  // Claim an epoch before creating jobs; repeat calls repair missing jobs from the frozen selection.
  const updated = await prisma.heuristicContest.updateMany({
    where: { contestId: contest.id, evaluationId: null },
    data: { evaluationId, finalSubmissionIds: board.selected },
  });
  if (!updated.count)
    return prisma.heuristicContest.findUniqueOrThrow({
      where: { contestId: contest.id },
    });
  for (const id of board.selected) {
    const s = submissions.find((s) => s.id === id)!;
    await enqueueHeuristicRun(s, "system", evaluationId);
  }
  return prisma.heuristicContest.findUniqueOrThrow({
    where: { contestId: contest.id },
  });
}
