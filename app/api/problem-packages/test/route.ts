import { NextResponse } from "next/server";
import { parseLanguage } from "@/lib/api-helpers";
import { errorResponse } from "@/lib/api-response";
import { executePackageJudge } from "@/lib/judge-runtime";
import { buildProblemPackageFromEditorDraft } from "@/lib/problem-package";
import { canCreateProblemByRole, getCurrentUser, HttpError } from "@/lib/store";
import { Language } from "@/lib/types";

export const runtime = "nodejs";

interface TestRunRequestBody {
  language?: unknown;
  sourceCode?: unknown;
  timeLimitMs?: unknown;
  memoryLimitMb?: unknown;
  draft?: {
    sourceLabel?: unknown;
    checkerType?: unknown;
    checkerLanguage?: unknown;
    checkerSourceCode?: unknown;
    compareMode?: unknown;
    zipSizeBytes?: unknown;
    fileCount?: unknown;
    samples?: unknown;
    warnings?: unknown;
    groups?: unknown;
  };
}

function parseCheckerType(raw: unknown): "exact" | "special_judge" {
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

function parseCompareMode(raw: unknown): "exact" | "ignore_trailing_spaces" {
  if (raw === "ignore_trailing_spaces") {
    return raw;
  }
  return "exact";
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (user.status !== "active") {
      throw new HttpError("user account is not active", 403);
    }
    if (!canCreateProblemByRole(user.role)) {
      throw new HttpError("problem creation requires problem_author role", 403);
    }

    const body = (await request.json()) as TestRunRequestBody;
    const sourceCode = typeof body.sourceCode === "string" ? body.sourceCode : "";
    if (!sourceCode.trim()) {
      throw new HttpError("sourceCode is required", 400);
    }
    if (!body.draft) {
      throw new HttpError("draft is required", 400);
    }

    const packageData = buildProblemPackageFromEditorDraft({
      sourceLabel:
        typeof body.draft.sourceLabel === "string" ? body.draft.sourceLabel : undefined,
      checkerType: parseCheckerType(body.draft.checkerType),
      checkerLanguage: parseCheckerLanguage(body.draft.checkerLanguage),
      checkerSourceCode:
        typeof body.draft.checkerSourceCode === "string"
          ? body.draft.checkerSourceCode
          : undefined,
      compareMode: parseCompareMode(body.draft.compareMode),
      zipSizeBytes:
        typeof body.draft.zipSizeBytes === "number" ? body.draft.zipSizeBytes : undefined,
      fileCount: typeof body.draft.fileCount === "number" ? body.draft.fileCount : undefined,
      samples: Array.isArray(body.draft.samples) ? body.draft.samples : [],
      warnings: Array.isArray(body.draft.warnings) ? body.draft.warnings : [],
      timeLimitMs:
        typeof body.timeLimitMs === "number" ? body.timeLimitMs : Number(body.timeLimitMs),
      memoryLimitMb:
        typeof body.memoryLimitMb === "number" ? body.memoryLimitMb : Number(body.memoryLimitMb),
      groups: Array.isArray(body.draft.groups) ? body.draft.groups : [],
    });

    let testResultCounter = 0;
    const result = await executePackageJudge({
      sourceCode,
      language: parseLanguage(body.language),
      timeLimitMs:
        typeof body.timeLimitMs === "number" ? body.timeLimitMs : Number(body.timeLimitMs),
      memoryLimitMb:
        typeof body.memoryLimitMb === "number" ? body.memoryLimitMb : Number(body.memoryLimitMb),
      packageData,
      nextTestResultId: () => `preview-test-result-${++testResultCounter}`,
    });

    return NextResponse.json({ result }, { status: 200 });
  } catch (error) {
    return errorResponse(error, "failed to run package test");
  }
}
