import { NextResponse } from "next/server";
import {
  getCurrentUser,
  getContestForViewer,
  canEditContestByViewer,
  getContestLiveData,
  listSubmissionsForViewer,
} from "@/lib/store";
import { startHeuristicSystemTest } from "@/lib/heuristic-store";
import { apiError, errorResponse } from "@/lib/api-response";
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ contestId: string }> },
) {
  try {
    const { contestId } = await params;
    const user = await getCurrentUser();
    const contest = getContestForViewer(contestId, user.id);
    if (
      !contest ||
      user.status !== "active" ||
      !canEditContestByViewer(contest, user.id)
    )
      return apiError(
        403,
        "Only an active organizer or administrator can start system tests",
      );
    await getContestLiveData(contestId, user);
    await startHeuristicSystemTest(
      contest,
      listSubmissionsForViewer(user.id, { contestId }),
    );
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error, "Unable to start system tests");
  }
}
