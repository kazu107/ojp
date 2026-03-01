import { NextResponse } from "next/server";
import { parseString } from "@/lib/api-helpers";
import { errorResponse } from "@/lib/api-response";
import { hideContestByAdmin } from "@/lib/store";

interface HideContestRouteContext {
  params: Promise<{
    contestId: string;
  }>;
}

export async function POST(request: Request, { params }: HideContestRouteContext) {
  try {
    const { contestId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const contest = hideContestByAdmin(contestId, parseString(body.reason));
    return NextResponse.json({ contest });
  } catch (error) {
    return errorResponse(error, "failed to hide contest");
  }
}
