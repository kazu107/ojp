import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-response";
import { joinContest } from "@/lib/store";

interface JoinContestRouteContext {
  params: Promise<{
    contestId: string;
  }>;
}

export async function POST(_request: Request, { params }: JoinContestRouteContext) {
  try {
    const { contestId } = await params;
    const contest = joinContest(contestId);
    return NextResponse.json({ contest });
  } catch (error) {
    return errorResponse(error, "contest join failed");
  }
}
