import { NextResponse } from "next/server";
import { parseLanguage } from "@/lib/api-helpers";
import { errorResponse } from "@/lib/api-response";
import { executePackageJudge } from "@/lib/judge-runtime";
import { validateProblemPackage } from "@/lib/problem-package";
import { canCreateProblemByRole, getCurrentUser, HttpError } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (user.status !== "active") {
      throw new HttpError("user account is not active", 403);
    }
    if (!canCreateProblemByRole(user.role)) {
      throw new HttpError("problem creation requires problem_author role", 403);
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new HttpError("zip file is required", 400);
    }

    const sourceCode = typeof formData.get("sourceCode") === "string" ? String(formData.get("sourceCode")) : "";
    if (!sourceCode.trim()) {
      throw new HttpError("sourceCode is required", 400);
    }

    const packageData = validateProblemPackage(
      file.name,
      Buffer.from(await file.arrayBuffer()),
    );

    let testResultCounter = 0;
    const result = await executePackageJudge({
      sourceCode,
      language: parseLanguage(formData.get("language")),
      timeLimitMs: Number(formData.get("timeLimitMs")),
      memoryLimitMb: Number(formData.get("memoryLimitMb")),
      packageData,
      nextTestResultId: () => `preview-test-result-${++testResultCounter}`,
    });

    return NextResponse.json({ result }, { status: 200 });
  } catch (error) {
    return errorResponse(error, "failed to run package test");
  }
}
