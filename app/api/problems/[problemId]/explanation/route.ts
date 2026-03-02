import { NextResponse } from "next/server";
import {
  parseExplanationVisibility,
  parseOptionalString,
} from "@/lib/api-helpers";
import { apiError, errorResponse } from "@/lib/api-response";
import {
  canViewProblemExplanation,
  getOptionalCurrentUser,
  getProblemForViewer,
  HttpError,
  updateProblem,
} from "@/lib/store";

interface ProblemExplanationRouteContext {
  params: Promise<{
    problemId: string;
  }>;
}

export async function GET(_request: Request, { params }: ProblemExplanationRouteContext) {
  try {
    const { problemId } = await params;
    const user = await getOptionalCurrentUser();
    const viewerId = user?.id ?? "guest";
    const problem = getProblemForViewer(problemId, viewerId);
    if (!problem) {
      return apiError(404, "problem not found");
    }
    if (!canViewProblemExplanation(problem, viewerId)) {
      throw new HttpError("you cannot view this explanation", 403);
    }
    return NextResponse.json({
      explanation: {
        problemId: problem.id,
        markdown: problem.explanationMarkdown,
        visibility: problem.explanationVisibility,
        updatedAt: problem.updatedAt,
      },
    });
  } catch (error) {
    return errorResponse(error, "failed to fetch problem explanation");
  }
}

export async function PUT(request: Request, { params }: ProblemExplanationRouteContext) {
  try {
    const { problemId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const explanationMarkdown = parseOptionalString(body.explanationMarkdown);
    if (typeof explanationMarkdown !== "string") {
      throw new HttpError("explanationMarkdown is required", 400);
    }

    const problem = await updateProblem(problemId, {
      explanationMarkdown,
      explanationVisibility:
        typeof body.explanationVisibility === "string"
          ? parseExplanationVisibility(body.explanationVisibility, "private")
          : undefined,
    });

    return NextResponse.json({
      explanation: {
        problemId: problem.id,
        markdown: problem.explanationMarkdown,
        visibility: problem.explanationVisibility,
        updatedAt: problem.updatedAt,
      },
    });
  } catch (error) {
    return errorResponse(error, "failed to update problem explanation");
  }
}
