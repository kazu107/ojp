import { NextResponse } from "next/server";
import { apiError, errorResponse } from "@/lib/api-response";
import { getContestById, HttpError, updateContest } from "@/lib/store";
import { ContestProblem } from "@/lib/types";

interface DeleteContestProblemRouteContext {
  params: Promise<{
    contestId: string;
    contestProblemId: string;
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

export async function DELETE(
  _request: Request,
  { params }: DeleteContestProblemRouteContext,
) {
  try {
    const { contestId, contestProblemId } = await params;
    const contest = getContestById(contestId);
    if (!contest) {
      return apiError(404, "contest not found");
    }

    const filtered = contest.problems.filter(
      (item) => item.problemId !== contestProblemId && item.label !== contestProblemId,
    );
    if (filtered.length === contest.problems.length) {
      throw new HttpError("contest problem not found", 404);
    }

    const updated = await updateContest(contestId, {
      problems: normalizeProblemsOrder(filtered),
    });

    return NextResponse.json({ contest: updated });
  } catch (error) {
    return errorResponse(error, "failed to remove contest problem");
  }
}
