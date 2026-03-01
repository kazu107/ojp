import { NextResponse } from "next/server";
import { parseLanguage, parseOptionalString, parseString } from "@/lib/api-helpers";
import { createSubmission, getOptionalCurrentUser, listSubmissionsForViewer } from "@/lib/store";
import { errorResponse } from "@/lib/api-response";
import { Language, SubmissionStatus } from "@/lib/types";

const STATUS_FILTER_VALUES: SubmissionStatus[] = [
  "WJ",
  "AC",
  "WA",
  "TLE",
  "MLE",
  "RE",
  "CE",
  "IE",
];

const LANGUAGE_FILTER_VALUES: Language[] = ["cpp", "python", "java", "javascript"];

function parseStatusFilter(raw: string | null): SubmissionStatus | undefined {
  if (!raw) {
    return undefined;
  }
  return STATUS_FILTER_VALUES.find((value) => value === raw);
}

function parseLanguageFilter(raw: string | null): Language | undefined {
  if (!raw) {
    return undefined;
  }
  return LANGUAGE_FILTER_VALUES.find((value) => value === raw);
}

function parseLimitFilter(raw: string | null): number | undefined {
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.min(200, Math.floor(parsed));
}

export async function GET(request: Request) {
  try {
    const user = await getOptionalCurrentUser();
    const params = new URL(request.url).searchParams;
    const mine = params.get("mine");
    if (mine === "1" && !user) {
      return NextResponse.json({ error: "authentication required for mine=1" }, { status: 401 });
    }

    const submissions = listSubmissionsForViewer(user?.id ?? "guest", {
      userId: mine === "1" ? user?.id : params.get("userId") || undefined,
      problemId: params.get("problemId") || undefined,
      contestId: params.get("contestId") || undefined,
      status: parseStatusFilter(params.get("status")),
      language: parseLanguageFilter(params.get("language")),
      limit: parseLimitFilter(params.get("limit")),
    }).map((submission) => ({
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
      judgedAt: submission.judgedAt,
    }));
    return NextResponse.json({ submissions });
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
