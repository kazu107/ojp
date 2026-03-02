import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-response";
import { updateContest } from "@/lib/store";

interface PublishContestRouteContext {
  params: Promise<{
    contestId: string;
  }>;
}

export async function POST(_request: Request, { params }: PublishContestRouteContext) {
  try {
    const { contestId } = await params;
    const contest = await updateContest(contestId, { visibility: "public" });
    return NextResponse.json({ contest });
  } catch (error) {
    return errorResponse(error, "failed to publish contest");
  }
}
