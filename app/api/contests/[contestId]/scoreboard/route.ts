import { NextResponse } from "next/server";
import {
  buildVisibleScoreboard,
  getContestForViewer,
  getCurrentUser,
} from "@/lib/store";

interface ScoreboardRouteContext {
  params: Promise<{
    contestId: string;
  }>;
}

export async function GET(_request: Request, { params }: ScoreboardRouteContext) {
  const { contestId } = await params;
  const user = getCurrentUser();
  const contest = getContestForViewer(contestId, user.id);
  if (!contest) {
    return NextResponse.json({ error: "contest not found" }, { status: 404 });
  }
  const result = buildVisibleScoreboard(contestId);
  return NextResponse.json({
    contestId,
    visibility: contest.scoreboardVisibility,
    detailLevel: result.detailLevel,
    rows: result.rows,
  });
}
