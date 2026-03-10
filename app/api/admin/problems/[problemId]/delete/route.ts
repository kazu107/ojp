import { NextResponse } from "next/server";
import { parseString } from "@/lib/api-helpers";
import { errorResponse } from "@/lib/api-response";
import { deleteProblemByAdmin } from "@/lib/store";

interface AdminDeleteProblemRouteContext {
  params: Promise<{
    problemId: string;
  }>;
}

export async function POST(request: Request, { params }: AdminDeleteProblemRouteContext) {
  try {
    const { problemId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const problem = await deleteProblemByAdmin(problemId, parseString(body.reason));
    return NextResponse.json({ problem }, { status: 200 });
  } catch (error) {
    return errorResponse(error, "failed to delete problem");
  }
}
