import { NextResponse } from "next/server";
import {
  parseLanguages,
  parseOptionalString,
  parsePositiveNumber,
  parseVisibility,
} from "@/lib/api-helpers";
import { getCurrentUser, getProblemForViewer, updateProblem } from "@/lib/store";
import { errorResponse } from "@/lib/api-response";

interface ProblemRouteContext {
  params: Promise<{
    problemId: string;
  }>;
}

export async function GET(_request: Request, { params }: ProblemRouteContext) {
  const { problemId } = await params;
  const user = getCurrentUser();
  const problem = getProblemForViewer(problemId, user.id);
  if (!problem) {
    return NextResponse.json({ error: "problem not found" }, { status: 404 });
  }
  return NextResponse.json({ problem });
}

export async function PATCH(request: Request, { params }: ProblemRouteContext) {
  try {
    const { problemId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const problem = updateProblem(problemId, {
      title: parseOptionalString(body.title),
      slug: parseOptionalString(body.slug),
      statementMarkdown: parseOptionalString(body.statementMarkdown),
      inputDescription: parseOptionalString(body.inputDescription),
      outputDescription: parseOptionalString(body.outputDescription),
      constraintsMarkdown: parseOptionalString(body.constraintsMarkdown),
      explanationMarkdown: parseOptionalString(body.explanationMarkdown),
      visibility:
        typeof body.visibility === "string"
          ? parseVisibility(body.visibility, "public")
          : undefined,
      timeLimitMs: parsePositiveNumber(body.timeLimitMs, -1),
      memoryLimitMb: parsePositiveNumber(body.memoryLimitMb, -1),
      supportedLanguages: Array.isArray(body.supportedLanguages)
        ? parseLanguages(body.supportedLanguages)
        : undefined,
    });
    return NextResponse.json({ problem });
  } catch (error) {
    return errorResponse(error, "problem update failed");
  }
}
