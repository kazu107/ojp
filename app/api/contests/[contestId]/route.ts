import { NextResponse } from "next/server";
import {
  parseNonNegativeNumber,
  parseOptionalString,
  parseVisibility,
} from "@/lib/api-helpers";
import {
  getContestForViewer,
  getOptionalCurrentUser,
  updateContest,
} from "@/lib/store";
import { ContestProblem, ScoreboardVisibility } from "@/lib/types";
import { errorResponse } from "@/lib/api-response";

interface ContestRouteContext {
  params: Promise<{
    contestId: string;
  }>;
}

function parseScoreboardVisibility(raw: unknown): ScoreboardVisibility | undefined {
  if (raw === "hidden" || raw === "partial" || raw === "full") {
    return raw;
  }
  return undefined;
}

function parseContestProblems(raw: unknown): ContestProblem[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }

  const parsed = raw
    .map((item, index) => {
      if (typeof item !== "object" || item === null) {
        return null;
      }
      const candidate = item as Record<string, unknown>;
      const problemId = typeof candidate.problemId === "string" ? candidate.problemId : "";
      if (!problemId) {
        return null;
      }
      return {
        label:
          typeof candidate.label === "string"
            ? candidate.label
            : String.fromCharCode(65 + index),
        problemId,
        score: typeof candidate.score === "number" ? candidate.score : 100,
        orderIndex: typeof candidate.orderIndex === "number" ? candidate.orderIndex : index,
      };
    })
    .filter((item): item is ContestProblem => item !== null);

  return parsed;
}

export async function GET(_request: Request, { params }: ContestRouteContext) {
  try {
    const { contestId } = await params;
    const user = await getOptionalCurrentUser();
    const contest = getContestForViewer(contestId, user?.id ?? "guest");
    if (!contest) {
      return NextResponse.json({ error: "contest not found" }, { status: 404 });
    }
    return NextResponse.json({ contest });
  } catch (error) {
    return errorResponse(error, "failed to fetch contest");
  }
}

export async function PATCH(request: Request, { params }: ContestRouteContext) {
  try {
    const { contestId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const contest = await updateContest(contestId, {
      title: parseOptionalString(body.title),
      slug: parseOptionalString(body.slug),
      descriptionMarkdown: parseOptionalString(body.descriptionMarkdown),
      visibility:
        typeof body.visibility === "string"
          ? parseVisibility(body.visibility, "public")
          : undefined,
      startAt: parseOptionalString(body.startAt),
      endAt: parseOptionalString(body.endAt),
      penaltyMinutes:
        typeof body.penaltyMinutes === "number"
          ? parseNonNegativeNumber(body.penaltyMinutes, 5)
          : undefined,
      scoreboardVisibility: parseScoreboardVisibility(body.scoreboardVisibility),
      problems: parseContestProblems(body.problems),
    });
    return NextResponse.json({ contest });
  } catch (error) {
    return errorResponse(error, "contest update failed");
  }
}
