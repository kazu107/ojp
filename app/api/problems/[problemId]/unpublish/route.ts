import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-response";
import { updateProblem } from "@/lib/store";

interface UnpublishProblemRouteContext {
  params: Promise<{
    problemId: string;
  }>;
}

export async function POST(_request: Request, { params }: UnpublishProblemRouteContext) {
  try {
    const { problemId } = await params;
    const problem = await updateProblem(problemId, { visibility: "private" });
    return NextResponse.json({ problem });
  } catch (error) {
    return errorResponse(error, "failed to unpublish problem");
  }
}
