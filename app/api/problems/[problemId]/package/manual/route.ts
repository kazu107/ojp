import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-response";
import {
  buildProblemPackageFromEditorDraft,
  buildProblemPackageZip,
} from "@/lib/problem-package";
import {
  applyProblemPackageValidation,
  getCurrentUser,
  getProblemById,
  HttpError,
} from "@/lib/store";
import {
  isProblemPackageObjectStorageEnabled,
  putProblemPackageZip,
} from "@/lib/problem-package-storage";
import {
  ProblemPackageCheckerType,
  ProblemPackageCompareMode,
  ProblemPackageEditorGroup,
  ProblemPackageEditorSampleCase,
} from "@/lib/problem-package-types";
import { Language } from "@/lib/types";

interface ProblemPackageManualRouteContext {
  params: Promise<{
    problemId: string;
  }>;
}

function parseCompareMode(raw: unknown): ProblemPackageCompareMode {
  if (raw === "ignore_trailing_spaces") {
    return raw;
  }
  return "exact";
}

function parseCheckerType(raw: unknown): ProblemPackageCheckerType {
  if (raw === "special_judge") {
    return raw;
  }
  return "exact";
}

function parseCheckerLanguage(raw: unknown): Language {
  if (raw === "cpp" || raw === "python" || raw === "java" || raw === "javascript") {
    return raw;
  }
  return "python";
}

export async function POST(request: Request, { params }: ProblemPackageManualRouteContext) {
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

    const body = (await request.json()) as {
      sourceLabel?: unknown;
      checkerType?: unknown;
      checkerLanguage?: unknown;
      checkerSourceCode?: unknown;
      timeLimitMs?: unknown;
      memoryLimitMb?: unknown;
      compareMode?: unknown;
      zipSizeBytes?: unknown;
      fileCount?: unknown;
      samples?: unknown;
      warnings?: unknown;
      groups?: unknown;
    };

    const extracted = buildProblemPackageFromEditorDraft({
      sourceLabel: typeof body.sourceLabel === "string" ? body.sourceLabel : undefined,
      checkerType: parseCheckerType(body.checkerType),
      checkerLanguage: parseCheckerLanguage(body.checkerLanguage),
      checkerSourceCode:
        typeof body.checkerSourceCode === "string" ? body.checkerSourceCode : undefined,
      timeLimitMs: typeof body.timeLimitMs === "number" ? body.timeLimitMs : Number(body.timeLimitMs),
      memoryLimitMb:
        typeof body.memoryLimitMb === "number" ? body.memoryLimitMb : Number(body.memoryLimitMb),
      compareMode: parseCompareMode(body.compareMode),
      zipSizeBytes:
        typeof body.zipSizeBytes === "number" ? body.zipSizeBytes : undefined,
      fileCount: typeof body.fileCount === "number" ? body.fileCount : undefined,
      samples: Array.isArray(body.samples) ? body.samples : [],
      warnings: Array.isArray(body.warnings) ? body.warnings.filter((item): item is string => typeof item === "string") : [],
      groups: Array.isArray(body.groups) ? (body.groups as ProblemPackageEditorGroup[]) : [],
    });

    const storageRef = isProblemPackageObjectStorageEnabled()
      ? await putProblemPackageZip({
          problemId,
          fileName: typeof body.sourceLabel === "string" ? body.sourceLabel : `${problemRecord.slug}.zip`,
          zipBuffer: buildProblemPackageZip({
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
            timeLimitMs:
              typeof body.timeLimitMs === "number" ? body.timeLimitMs : Number(body.timeLimitMs),
            memoryLimitMb:
              typeof body.memoryLimitMb === "number" ? body.memoryLimitMb : Number(body.memoryLimitMb),
            draft: {
              sourceLabel:
                typeof body.sourceLabel === "string" ? body.sourceLabel : "manual-package",
              checkerType: parseCheckerType(body.checkerType),
              checkerLanguage: parseCheckerLanguage(body.checkerLanguage),
              checkerSourceCode:
                typeof body.checkerSourceCode === "string" ? body.checkerSourceCode : "",
              compareMode: parseCompareMode(body.compareMode),
              zipSizeBytes:
                typeof body.zipSizeBytes === "number" ? body.zipSizeBytes : 0,
              fileCount: typeof body.fileCount === "number" ? body.fileCount : 0,
              samples: Array.isArray(body.samples)
                ? (body.samples as ProblemPackageEditorSampleCase[])
                : [],
              warnings: Array.isArray(body.warnings)
                ? body.warnings.filter((item): item is string => typeof item === "string")
                : [],
              groups: Array.isArray(body.groups) ? (body.groups as ProblemPackageEditorGroup[]) : [],
            },
          }),
        })
      : null;

    const problem = await applyProblemPackageValidation(problemId, extracted, storageRef);
    return NextResponse.json({ package: extracted.validation, problem }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "failed to save manual problem package");
  }
}
