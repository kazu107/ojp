import { NextResponse } from "next/server";
import {
  parseNonNegativeNumber,
  parseOptionalString,
  parseString,
} from "@/lib/api-helpers";
import { apiError, errorResponse } from "@/lib/api-response";
import { getContestById, HttpError, updateContest } from "@/lib/store";
import { ContestProblem } from "@/lib/types";

interface ContestProblemsRouteContext {
  params: Promise<{
    contestId: string;
  }>;
}

function normalizeProblemsOrder(problems: ContestProblem[]): ContestProblem[] {
  return [...problems]
    .sort((left, right) => left.orderIndex - right.orderIndex)
    .map((problem, index) => ({
      ...problem,
      orderIndex: index,
    }));
}

export async function POST(request: Request, { params }: ContestProblemsRouteContext) {
  try {
    const { contestId } = await params;
    const contest = getContestById(contestId);
    if (!contest) {
      return apiError(404, "contest not found");
    }

    const body = (await request.json()) as Record<string, unknown>;
    const problemId = parseString(body.problemId).trim();
    if (!problemId) {
      throw new HttpError("problemId is required", 400);
    }

    const requestedLabel = parseOptionalString(body.label)?.trim();
    const nextLabel = requestedLabel || String.fromCharCode(65 + contest.problems.length);
    if (contest.problems.some((item) => item.problemId === problemId)) {
      throw new HttpError("problem already included in contest", 409);
    }
    if (contest.problems.some((item) => item.label === nextLabel)) {
      throw new HttpError("label already used in contest", 409);
    }

    const appended: ContestProblem = {
      problemId,
      label: nextLabel,
      score: parseNonNegativeNumber(body.score, 100),
      orderIndex: contest.problems.length,
    };

    const updated = await updateContest(contestId, {
      problems: normalizeProblemsOrder([...contest.problems, appended]),
    });

    return NextResponse.json({ contest: updated });
  } catch (error) {
    return errorResponse(error, "failed to add contest problem");
  }
}
