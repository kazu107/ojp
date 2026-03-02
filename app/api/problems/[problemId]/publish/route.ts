import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-response";
import { updateProblem } from "@/lib/store";

interface PublishProblemRouteContext {
  params: Promise<{
    problemId: string;
  }>;
}

export async function POST(_request: Request, { params }: PublishProblemRouteContext) {
  try {
    const { problemId } = await params;
    const problem = await updateProblem(problemId, { visibility: "public" });
    return NextResponse.json({ problem });
  } catch (error) {
    return errorResponse(error, "failed to publish problem");
  }
}
