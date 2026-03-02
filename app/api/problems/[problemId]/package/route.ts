import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-response";
import { validateProblemPackage } from "@/lib/problem-package";
import { applyProblemPackageValidation } from "@/lib/store";

interface ProblemPackageRouteContext {
  params: Promise<{
    problemId: string;
  }>;
}

export const runtime = "nodejs";

export async function POST(request: Request, { params }: ProblemPackageRouteContext) {
  try {
    const { problemId } = await params;

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "zip file is required (multipart/form-data field: file)" },
        { status: 400 },
      );
    }

    const zipBuffer = Buffer.from(await file.arrayBuffer());
    const extracted = validateProblemPackage(file.name, zipBuffer);
    const problem = await applyProblemPackageValidation(problemId, extracted);
    return NextResponse.json({ package: extracted.validation, problem }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "failed to validate problem package");
  }
}
