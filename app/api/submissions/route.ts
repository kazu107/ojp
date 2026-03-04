import { NextResponse } from "next/server";
import {
  paginateItems,
  parseLanguage,
  parseOptionalString,
  parsePaginationQuery,
  parseString,
} from "@/lib/api-helpers";
import { createSubmission, getOptionalCurrentUser, listSubmissionsForViewer } from "@/lib/store";
import { apiError, errorResponse } from "@/lib/api-response";
import { SubmissionStatus } from "@/lib/types";
import { normalizeSubmissionStatus, SUBMISSION_STATUS_VALUES } from "@/lib/submission-status";

const STATUS_FILTER_VALUES: SubmissionStatus[] = SUBMISSION_STATUS_VALUES;

function parseStatusFilter(raw: string | null): SubmissionStatus | undefined {
  const normalized = normalizeSubmissionStatus(raw);
  if (!normalized) {
    return undefined;
  }
  return STATUS_FILTER_VALUES.find((value) => value === normalized);
}

export async function GET(request: Request) {
  try {
    const user = await getOptionalCurrentUser();
    const params = new URL(request.url).searchParams;
    const mine = params.get("mine");
    if (mine === "1" && !user) {
      return apiError(401, "authentication required for mine=1");
    }

    const pagination = parsePaginationQuery(params, {
      defaultLimit: 50,
      maxLimit: 200,
    });

    const filtered = listSubmissionsForViewer(user?.id ?? "guest", {
      userId: mine === "1" ? user?.id : params.get("userId") || undefined,
      problemId: params.get("problemId") || undefined,
      contestId: params.get("contestId") || undefined,
      status: parseStatusFilter(params.get("status")),
    });

    const { items, meta } = paginateItems(filtered, pagination);
    const submissions = items.map((submission) => ({
      id: submission.id,
      userId: submission.userId,
      problemId: submission.problemId,
      contestId: submission.contestId,
      language: submission.language,
      status: submission.status,
      score: submission.score,
      totalTimeMs: submission.totalTimeMs,
      peakMemoryKb: submission.peakMemoryKb,
      submittedAt: submission.submittedAt,
      judgeStartedAt: submission.judgeStartedAt,
      judgedAt: submission.judgedAt,
      judgeEnvironmentVersion: submission.judgeEnvironmentVersion,
    }));
    return NextResponse.json({ submissions, pagination: meta });
  } catch (error) {
    return errorResponse(error, "failed to fetch submissions");
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const submission = await createSubmission({
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
