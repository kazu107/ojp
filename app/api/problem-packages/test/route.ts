import { NextResponse } from "next/server";
import { parseLanguage } from "@/lib/api-helpers";
import { errorResponse } from "@/lib/api-response";
import { ProblemPackageStorageRef } from "@/lib/problem-package-storage";
import { validateProblemPackageCached } from "@/lib/problem-package-cache";
import { executePackageJudge } from "@/lib/judge-runtime";
import {
  canCreateProblemByRole,
  createProblemPackagePreviewJob,
  getCurrentUser,
  HttpError,
} from "@/lib/store";

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

    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");
      if (!(file instanceof File)) {
        throw new HttpError("zip file is required", 400);
      }

      const sourceCode =
        typeof formData.get("sourceCode") === "string" ? String(formData.get("sourceCode")) : "";
      if (!sourceCode.trim()) {
        throw new HttpError("sourceCode is required", 400);
      }

      const packageData = validateProblemPackageCached(
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
    }

    const body = (await request.json()) as {
      storageRef?: ProblemPackageStorageRef;
      fileName?: string;
      sourceCode?: string;
      language?: unknown;
      timeLimitMs?: unknown;
      memoryLimitMb?: unknown;
      problemId?: unknown;
    };
    if (!body.storageRef) {
      throw new HttpError("storageRef is required", 400);
    }
    if (typeof body.fileName !== "string" || !body.fileName.trim()) {
      throw new HttpError("fileName is required", 400);
    }
    const sourceCode = typeof body.sourceCode === "string" ? body.sourceCode : "";
    if (!sourceCode.trim()) {
      throw new HttpError("sourceCode is required", 400);
    }

    const job = await createProblemPackagePreviewJob({
      problemId: typeof body.problemId === "string" ? body.problemId : null,
      fileName: body.fileName,
      storageRef: body.storageRef,
      sourceCode,
      language: parseLanguage(body.language),
      timeLimitMs: Number(body.timeLimitMs),
      memoryLimitMb: Number(body.memoryLimitMb),
    });

    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    return errorResponse(error, "failed to run package test");
  }
}
