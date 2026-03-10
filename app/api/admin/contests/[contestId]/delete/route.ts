import { NextResponse } from "next/server";
import { parseString } from "@/lib/api-helpers";
import { errorResponse } from "@/lib/api-response";
import { deleteContestByAdmin } from "@/lib/store";

interface AdminDeleteContestRouteContext {
  params: Promise<{
    contestId: string;
  }>;
}

export async function POST(request: Request, { params }: AdminDeleteContestRouteContext) {
  try {
    const { contestId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const contest = await deleteContestByAdmin(contestId, parseString(body.reason));
    return NextResponse.json({ contest }, { status: 200 });
  } catch (error) {
    return errorResponse(error, "failed to delete contest");
  }
}
