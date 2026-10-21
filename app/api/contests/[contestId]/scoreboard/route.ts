import { NextResponse } from "next/server";
import {
  getContestLiveData,
  getOptionalCurrentUser,
} from "@/lib/store";
import { errorResponse } from "@/lib/api-response";

interface ScoreboardRouteContext {
  params: Promise<{
    contestId: string;
  }>;
}

export async function GET(_request: Request, { params }: ScoreboardRouteContext) {
  try {
    const { contestId } = await params;
    const user = await getOptionalCurrentUser();
    return NextResponse.json(await getContestLiveData(contestId,user),{headers:{"Cache-Control":"private, no-store"}});
  } catch (error) {
    return errorResponse(error, "failed to fetch scoreboard");
  }
}
