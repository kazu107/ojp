import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  getOptionalCurrentUser,
  getSubmissionWithAccess,
  getProblemById,
} from "@/lib/store";
import { apiError, errorResponse } from "@/lib/api-response";
import { parseHeuristicConfig } from "@/lib/heuristic-config";
import { absoluteScore, scoreString } from "@/lib/heuristic-score";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ submissionId: string }> },
) {
  try {
    const { submissionId } = await params;
    const user = await getOptionalCurrentUser();
    const access = await getSubmissionWithAccess(
      submissionId,
      user?.id ?? "guest",
    );
    if (!access) return apiError(404, "Submission not found");
    const problem = getProblemById(access.submission.problemId);
    const privileged =
      user?.status === "active" &&
      (user.role === "admin" || problem?.authorId === user.id);
    const system = new URL(request.url).searchParams.get("phase") === "system";
    const final =
      system && access.submission.contestId
        ? await prisma.heuristicContest.findUnique({
            where: { contestId: access.submission.contestId },
          })
        : null;
    if (system && (!final?.evaluationId || (!privileged && !final.finalizedAt)))
      return apiError(404, "Published system results not available");
    const run = await prisma.heuristicRun.findFirst({
      where: {
        submissionId,
        phase: system ? "system" : "provisional",
        ...(system ? { evaluationId: final!.evaluationId! } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        cases: { orderBy: [{ groupName: "asc" }, { caseName: "asc" }] },
      },
    });
    if (!run && system)
      return apiError(404, "This submission was not selected for system tests");
    if (!run)
      return NextResponse.json(
        { run: null },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    const config = parseHeuristicConfig(run.config);
    const metadata = run.config as unknown as {
      expectedGroups?: Array<{ name: string; count: number }>;
    };
    const names = [
      ...new Set([
        ...(metadata.expectedGroups ?? []).map((g) => g.name),
        ...run.cases.map((c) => c.groupName),
      ]),
    ];
    const groups = names.map((name) => {
      const cases = run.cases.filter((c) => c.groupName === name);
      const expected =
        metadata.expectedGroups?.find((g) => g.name === name)?.count ??
        cases.length;
      const values = cases.map((c) => ({
        key: c.caseKey,
        verdict: c.verdict,
        rawScore: c.rawScore ? scoreString(c.rawScore) : null,
      }));
      return {
        name,
        completed: cases.length,
        expected,
        score: cases.length === expected ? absoluteScore(config, values) : null,
        maxTimeMs: Math.max(0, ...cases.map((c) => c.timeMs)),
        memoryKb: Math.max(0, ...cases.map((c) => c.memoryKb)),
        cases:
          !privileged && problem?.testCaseVisibility === "group_only"
            ? []
            : cases.map((c, i) => ({
                name:
                  privileged ||
                  problem?.testCaseVisibility === "case_name_visible"
                    ? c.caseName
                    : String(i + 1),
                verdict: c.verdict,
                score: c.rawScore ? scoreString(c.rawScore) : null,
                timeMs: c.timeMs,
                memoryKb: c.memoryKb,
                diagnostic: privileged ? c.diagnostic : undefined,
              })),
      };
    });
    const history =
      privileged || access.submission.userId === user?.id
        ? await prisma.heuristicRun.findMany({
            where: { submissionId, phase: "provisional" },
            orderBy: { createdAt: "desc" },
            take: 10,
            select: {
              id: true,
              status: true,
              score: true,
              createdAt: true,
              revisionId: true,
            },
          })
        : [];
    return NextResponse.json(
      {
        run: {
          id: run.id,
          status: run.status,
          phase: run.phase,
          score: run.score ? scoreString(run.score) : null,
          direction: config.direction,
          evaluation: config.evaluation,
          aggregate: config.aggregate,
          error: privileged
            ? run.error
            : run.status === "failed"
              ? "Heuristic judge failed. Contact the problem author."
              : undefined,
          groups,
          history: history.map((h) => ({
            ...h,
            score: h.score ? scoreString(h.score) : null,
          })),
        },
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error, "Unable to load heuristic results");
  }
}
