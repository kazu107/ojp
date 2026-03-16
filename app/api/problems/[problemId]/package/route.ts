import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-response";
import { buildEditorDraftFromExtracted, buildProblemPackageZip } from "@/lib/problem-package";
import { validateProblemPackageCached } from "@/lib/problem-package-cache";
import {
  getProblemPackageZipStream,
  isProblemPackageObjectStorageEnabled,
  putProblemPackageZip,
  putProblemPackageZipStream,
} from "@/lib/problem-package-storage";
import {
  applyProblemPackageValidation,
  createProblemPackageApplyJob,
  getCurrentUser,
  getProblemById,
  getProblemPackageData,
  getProblemPackageStorageRef,
  HttpError,
} from "@/lib/store";

interface ProblemPackageRouteContext {
  params: Promise<{
    problemId: string;
  }>;
}

export const runtime = "nodejs";
const MAX_UPLOAD_BYTES = 256 * 1024 * 1024;

function contentDispositionFileName(fileName: string): string {
  return fileName.replace(/["\r\n]/g, "_");
}

export async function GET(_request: Request, { params }: ProblemPackageRouteContext) {
  try {
    const { problemId } = await params;
    const actor = await getCurrentUser();
    const problemRecord = getProblemById(problemId);
    if (!problemRecord) {
      throw new HttpError("problem not found", 404);
    }
    if (actor.role !== "admin" && problemRecord.authorId !== actor.id) {
      throw new HttpError("you cannot download package for this problem", 403);
    }

    const fileName = problemRecord.latestPackageSummary?.fileName ?? `${problemRecord.slug}.zip`;
    const storageRef = getProblemPackageStorageRef(problemId);
    if (storageRef && isProblemPackageObjectStorageEnabled()) {
      const stream = await getProblemPackageZipStream(storageRef);
      return new Response(stream, {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${contentDispositionFileName(fileName)}"`,
          "Content-Length": String(storageRef.sizeBytes),
          "Cache-Control": "private, no-store",
        },
      });
    }

    const packageData = await getProblemPackageData(problemId);
    if (!packageData) {
      throw new HttpError("problem package not found", 404);
    }

    const zipBuffer = buildProblemPackageZip({
      title: problemRecord.title,
      slug: problemRecord.slug,
      visibility: problemRecord.visibility,
      explanationVisibility: problemRecord.explanationVisibility,
      difficulty: problemRecord.difficulty,
      testCaseVisibility: problemRecord.testCaseVisibility,
      statementMarkdown: problemRecord.statementMarkdown,
      inputDescription: problemRecord.inputDescription,
      outputDescription: problemRecord.outputDescription,
      constraintsMarkdown: problemRecord.constraintsMarkdown,
      explanationMarkdown: problemRecord.explanationMarkdown,
      timeLimitMs: problemRecord.timeLimitMs,
      memoryLimitMb: problemRecord.memoryLimitMb,
      draft: buildEditorDraftFromExtracted(packageData),
    });

    return new Response(new Uint8Array(zipBuffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${contentDispositionFileName(fileName)}"`,
        "Content-Length": String(zipBuffer.byteLength),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return errorResponse(error, "failed to download problem package");
  }
}

export async function PUT(request: Request, { params }: ProblemPackageRouteContext) {
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

    const fileName = request.headers.get("x-ojp-file-name")?.trim();
    const sizeBytes = Number(request.headers.get("x-ojp-file-size") ?? "0");
    if (!fileName) {
      throw new HttpError("x-ojp-file-name header is required", 400);
    }
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      throw new HttpError("x-ojp-file-size header is required for streamed uploads", 400);
    }
    if (Number.isFinite(sizeBytes) && sizeBytes > MAX_UPLOAD_BYTES) {
      throw new HttpError(`zip size exceeds limit (${MAX_UPLOAD_BYTES} bytes)`, 400);
    }

    if (!request.body) {
      throw new HttpError("zip request body is required", 400);
    }

    if (!isProblemPackageObjectStorageEnabled()) {
      const zipBuffer = Buffer.from(await request.arrayBuffer());
      const extracted = validateProblemPackageCached(fileName, zipBuffer);
      const problem = await applyProblemPackageValidation(problemId, extracted, null);
      return NextResponse.json({ package: extracted.validation, problem }, { status: 201 });
    }

    const storageRef = await putProblemPackageZipStream({
      keyPrefix: `problem-packages/${problemId}/pending`,
      fileName,
      body: Readable.fromWeb(request.body as unknown as NodeReadableStream<Uint8Array>),
      sizeBytes,
    });
    const job = await createProblemPackageApplyJob({
      problemId,
      fileName,
      storageRef,
    });

    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    return errorResponse(error, "failed to enqueue problem package validation");
  }
}

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
