import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-response";
import { buildProblemPackageFromEditorDraft } from "@/lib/problem-package";
import { applyProblemPackageValidation } from "@/lib/store";
import {
  ProblemPackageCheckerType,
  ProblemPackageCompareMode,
  ProblemPackageEditorGroup,
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
    const body = (await request.json()) as {
      sourceLabel?: unknown;
      checkerType?: unknown;
      checkerLanguage?: unknown;
      checkerSourceCode?: unknown;
      timeLimitMs?: unknown;
      memoryLimitMb?: unknown;
      compareMode?: unknown;
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
      samples: Array.isArray(body.samples) ? body.samples : [],
      warnings: Array.isArray(body.warnings) ? body.warnings.filter((item): item is string => typeof item === "string") : [],
      groups: Array.isArray(body.groups) ? (body.groups as ProblemPackageEditorGroup[]) : [],
    });

    const problem = await applyProblemPackageValidation(problemId, extracted);
    return NextResponse.json({ package: extracted.validation, problem }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "failed to save manual problem package");
  }
}
