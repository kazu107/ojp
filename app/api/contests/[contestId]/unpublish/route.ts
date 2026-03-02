import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-response";
import { updateContest } from "@/lib/store";

interface UnpublishContestRouteContext {
  params: Promise<{
    contestId: string;
  }>;
}

export async function POST(_request: Request, { params }: UnpublishContestRouteContext) {
  try {
    const { contestId } = await params;
    const contest = await updateContest(contestId, { visibility: "private" });
    return NextResponse.json({ contest });
  } catch (error) {
    return errorResponse(error, "failed to unpublish contest");
  }
}
