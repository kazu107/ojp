import { NextResponse } from "next/server";
import { parseLanguage, parseOptionalString, parseString } from "@/lib/api-helpers";
import { createSubmission } from "@/lib/store";
import { errorResponse } from "@/lib/api-response";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const submission = createSubmission({
      problemId: parseString(body.problemId),
      contestId: parseOptionalString(body.contestId) ?? null,
      language: parseLanguage(body.language),
      sourceCode: parseString(body.sourceCode),
    });
    return NextResponse.json({ submission }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "submission failed");
  }
}
