import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-response";
import { validateProblemPackageCached } from "@/lib/problem-package-cache";
import { isProblemPackageObjectStorageEnabled, putProblemPackageZip } from "@/lib/problem-package-storage";
import { applyProblemPackageValidation, getCurrentUser, getProblemById, HttpError } from "@/lib/store";

interface ProblemPackageRouteContext {
  params: Promise<{
    problemId: string;
  }>;
}

export const runtime = "nodejs";

export async function POST(request: Request, { params }: ProblemPackageRouteContext) {
  try {
    const { problemId } = await params;
    const actor = await getCurrentUser();
    const problemRecord = getProblemById(problemId);
    if (!problemRecord) {
      throw new HttpError("problem not found", 404);
    }
    if (actor.role !== "admin" && problemRecord.authorId !== actor.id) {
      throw new HttpError("you cannot upload package for this problem", 403);
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "zip file is required (multipart/form-data field: file)" },
        { status: 400 },
      );
    }

    const zipBuffer = Buffer.from(await file.arrayBuffer());
    const extracted = validateProblemPackageCached(file.name, zipBuffer);
    const storageRef = isProblemPackageObjectStorageEnabled()
      ? await putProblemPackageZip({
          problemId,
          fileName: file.name,
          zipBuffer,
        })
      : null;
    const problem = await applyProblemPackageValidation(problemId, extracted, storageRef);
    return NextResponse.json({ package: extracted.validation, problem }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "failed to validate problem package");
  }
}
