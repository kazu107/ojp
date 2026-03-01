import { NextResponse } from "next/server";
import {
  parseExplanationVisibility,
  parseLanguages,
  parsePositiveNumber,
  parseString,
  parseTestCaseVisibility,
  parseVisibility,
} from "@/lib/api-helpers";
import {
  createProblem,
  getOptionalCurrentUser,
  listProblemsForListView,
} from "@/lib/store";
import { errorResponse } from "@/lib/api-response";

export async function GET() {
  try {
    const user = await getOptionalCurrentUser();
    const problems = listProblemsForListView(user?.id ?? "guest");
    return NextResponse.json({ problems });
  } catch (error) {
    return errorResponse(error, "failed to fetch problems");
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const problem = await createProblem({
      title: parseString(body.title).trim(),
      slug: parseString(body.slug).trim(),
      statementMarkdown: parseString(body.statementMarkdown),
      inputDescription: parseString(body.inputDescription),
      outputDescription: parseString(body.outputDescription),
      constraintsMarkdown: parseString(body.constraintsMarkdown),
      explanationMarkdown: parseString(body.explanationMarkdown),
      explanationVisibility: parseExplanationVisibility(body.explanationVisibility, "private"),
      visibility: parseVisibility(body.visibility, "private"),
      timeLimitMs: parsePositiveNumber(body.timeLimitMs, 2000),
      memoryLimitMb: parsePositiveNumber(body.memoryLimitMb, 512),
      supportedLanguages: parseLanguages(body.supportedLanguages),
      testCaseVisibility: parseTestCaseVisibility(body.testCaseVisibility, "case_index_only"),
    });
    return NextResponse.json({ problem }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "problem creation failed");
  }
}
