import { NextResponse } from "next/server";
import {
  getContestForViewer,
  getOptionalCurrentUser,
  updateContest,
} from "@/lib/store";
import { readContestInput } from "@/lib/contest-api";
import { apiError, errorResponse } from "@/lib/api-response";

interface ContestRouteContext {
  params: Promise<{
    contestId: string;
  }>;
}

export async function GET(_request: Request, { params }: ContestRouteContext) {
  try {
    const { contestId } = await params;
    const user = await getOptionalCurrentUser();
    const contest = getContestForViewer(contestId, user?.id ?? "guest");
    if (!contest) {
      return apiError(404, "contest not found");
    }
    return NextResponse.json({ contest });
  } catch (error) {
    return errorResponse(error, "failed to fetch contest");
  }
}

export async function PATCH(request: Request, { params }: ContestRouteContext) {
  try {
    const { contestId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const contest = await updateContest(contestId, readContestInput(body));
    return NextResponse.json({ contest });
  } catch (error) {
    return errorResponse(error, "contest update failed");
  }
}
