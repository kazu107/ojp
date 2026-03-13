import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-response";
import { buildProblemPackageZip } from "@/lib/problem-package";
import { canCreateProblemByRole, getCurrentUser, HttpError } from "@/lib/store";
import {
  ExplanationVisibility,
  TestCaseVisibility,
  Visibility,
} from "@/lib/types";

interface ExportRequestBody {
  title?: unknown;
  slug?: unknown;
  statementMarkdown?: unknown;
  inputDescription?: unknown;
  outputDescription?: unknown;
  constraintsMarkdown?: unknown;
  explanationMarkdown?: unknown;
  visibility?: unknown;
  explanationVisibility?: unknown;
  difficulty?: unknown;
  testCaseVisibility?: unknown;
  timeLimitMs?: unknown;
  memoryLimitMb?: unknown;
  draft?: unknown;
}

function parseVisibility(raw: unknown): Visibility {
  if (raw === "public" || raw === "unlisted" || raw === "private") {
    return raw;
  }
  return "public";
}

function parseExplanationVisibility(raw: unknown): ExplanationVisibility {
  if (raw === "always" || raw === "contest_end" || raw === "private") {
    return raw;
  }
  return "private";
}

function parseTestCaseVisibility(raw: unknown): TestCaseVisibility {
  if (raw === "group_only" || raw === "case_index_only" || raw === "case_name_visible") {
    return raw;
  }
  return "case_index_only";
}

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

    const body = (await request.json()) as ExportRequestBody;
    if (!body.draft || typeof body.draft !== "object") {
      throw new HttpError("draft is required", 400);
    }

    const zipBuffer = buildProblemPackageZip({
      title: typeof body.title === "string" ? body.title : "",
      slug: typeof body.slug === "string" ? body.slug : "",
      visibility: parseVisibility(body.visibility),
      explanationVisibility: parseExplanationVisibility(body.explanationVisibility),
      difficulty:
        typeof body.difficulty === "number" ? body.difficulty : body.difficulty === null ? null : null,
      testCaseVisibility: parseTestCaseVisibility(body.testCaseVisibility),
      statementMarkdown:
        typeof body.statementMarkdown === "string" ? body.statementMarkdown : "",
      inputDescription: typeof body.inputDescription === "string" ? body.inputDescription : "",
      outputDescription: typeof body.outputDescription === "string" ? body.outputDescription : "",
      constraintsMarkdown:
        typeof body.constraintsMarkdown === "string" ? body.constraintsMarkdown : "",
      explanationMarkdown:
        typeof body.explanationMarkdown === "string" ? body.explanationMarkdown : "",
      timeLimitMs:
        typeof body.timeLimitMs === "number" ? body.timeLimitMs : Number(body.timeLimitMs),
      memoryLimitMb:
        typeof body.memoryLimitMb === "number" ? body.memoryLimitMb : Number(body.memoryLimitMb),
      draft: body.draft as Parameters<typeof buildProblemPackageZip>[0]["draft"],
    });

    const filename = `${typeof body.slug === "string" && body.slug.trim() ? body.slug.trim() : "problem-package"}.zip`;
    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return errorResponse(error, "failed to export problem package");
  }
}
