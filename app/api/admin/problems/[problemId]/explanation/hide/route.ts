import { NextResponse } from "next/server";
import { parseString } from "@/lib/api-helpers";
import { errorResponse } from "@/lib/api-response";
import { hideProblemExplanationByAdmin } from "@/lib/store";

interface HideProblemExplanationRouteContext {
  params: Promise<{
    problemId: string;
  }>;
}

export async function POST(
  request: Request,
  { params }: HideProblemExplanationRouteContext,
) {
  try {
    const { problemId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const problem = await hideProblemExplanationByAdmin(problemId, parseString(body.reason));
    return NextResponse.json({ problem });
  } catch (error) {
    return errorResponse(error, "failed to hide problem explanation");
  }
}
