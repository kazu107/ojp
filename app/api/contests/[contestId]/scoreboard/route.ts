import { NextResponse } from "next/server";
import {
  buildVisibleScoreboard,
  getContestForViewer,
  getOptionalCurrentUser,
} from "@/lib/store";
import { apiError, errorResponse } from "@/lib/api-response";

interface ScoreboardRouteContext {
  params: Promise<{
    contestId: string;
  }>;
}

export async function GET(_request: Request, { params }: ScoreboardRouteContext) {
  try {
    const { contestId } = await params;
    const user = await getOptionalCurrentUser();
    const contest = getContestForViewer(contestId, user?.id ?? "guest");
    if (!contest) {
      return apiError(404, "contest not found");
    }
    const result = buildVisibleScoreboard(contestId);
    return NextResponse.json({
      contestId,
      visibility: contest.scoreboardVisibility,
      detailLevel: result.detailLevel,
      rows: result.rows,
    });
  } catch (error) {
    return errorResponse(error, "failed to fetch scoreboard");
  }
}
