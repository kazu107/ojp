import { NextResponse } from "next/server";
import {
  parseLanguages,
  parsePositiveNumber,
  parseString,
  parseVisibility,
} from "@/lib/api-helpers";
import { createProblem, getCurrentUser, listProblemsForListView } from "@/lib/store";
import { errorResponse } from "@/lib/api-response";

export async function GET() {
  try {
    const user = await getCurrentUser();
    const problems = listProblemsForListView(user.id);
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
      visibility: parseVisibility(body.visibility, "private"),
      timeLimitMs: parsePositiveNumber(body.timeLimitMs, 2000),
      memoryLimitMb: parsePositiveNumber(body.memoryLimitMb, 512),
      supportedLanguages: parseLanguages(body.supportedLanguages),
    });
    return NextResponse.json({ problem }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "problem creation failed");
  }
}
