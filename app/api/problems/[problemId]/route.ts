import { NextResponse } from "next/server";
import {
  parseExplanationVisibility,
  parseLanguages,
  parseOptionalString,
  parsePositiveNumber,
  parseTestCaseVisibility,
  parseVisibility,
} from "@/lib/api-helpers";
import {
  getOptionalCurrentUser,
  getProblemForViewer,
  updateProblem,
} from "@/lib/store";
import { apiError, errorResponse } from "@/lib/api-response";

interface ProblemRouteContext {
  params: Promise<{
    problemId: string;
  }>;
}

export async function GET(_request: Request, { params }: ProblemRouteContext) {
  try {
    const { problemId } = await params;
    const user = await getOptionalCurrentUser();
    const problem = getProblemForViewer(problemId, user?.id ?? "guest");
    if (!problem) {
      return apiError(404, "problem not found");
    }
    return NextResponse.json({ problem });
  } catch (error) {
    return errorResponse(error, "failed to fetch problem");
  }
}

export async function PATCH(request: Request, { params }: ProblemRouteContext) {
  try {
    const { problemId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const problem = await updateProblem(problemId, {
      title: parseOptionalString(body.title),
      slug: parseOptionalString(body.slug),
      statementMarkdown: parseOptionalString(body.statementMarkdown),
      inputDescription: parseOptionalString(body.inputDescription),
      outputDescription: parseOptionalString(body.outputDescription),
      constraintsMarkdown: parseOptionalString(body.constraintsMarkdown),
      explanationMarkdown: parseOptionalString(body.explanationMarkdown),
      explanationVisibility:
        typeof body.explanationVisibility === "string"
          ? parseExplanationVisibility(body.explanationVisibility, "private")
          : undefined,
      visibility:
        typeof body.visibility === "string"
          ? parseVisibility(body.visibility, "public")
          : undefined,
      timeLimitMs: parsePositiveNumber(body.timeLimitMs, -1),
      memoryLimitMb: parsePositiveNumber(body.memoryLimitMb, -1),
      supportedLanguages: Array.isArray(body.supportedLanguages)
        ? parseLanguages(body.supportedLanguages)
        : undefined,
      testCaseVisibility:
        typeof body.testCaseVisibility === "string"
          ? parseTestCaseVisibility(body.testCaseVisibility, "case_index_only")
          : undefined,
    });
    return NextResponse.json({ problem });
  } catch (error) {
    return errorResponse(error, "problem update failed");
  }
}
