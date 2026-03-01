import { NextResponse } from "next/server";
import {
  parseNonNegativeNumber,
  parseString,
  parseVisibility,
} from "@/lib/api-helpers";
import {
  createContest,
  getCurrentUser,
  listContestsForListView,
  listPublicProblems,
} from "@/lib/store";
import { ContestProblem, ScoreboardVisibility } from "@/lib/types";
import { errorResponse } from "@/lib/api-response";

function parseScoreboardVisibility(raw: unknown): ScoreboardVisibility {
  if (raw === "hidden" || raw === "partial" || raw === "full") {
    return raw;
  }
  return "full";
}

function parseContestProblems(raw: unknown): ContestProblem[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item, index) => {
      if (typeof item !== "object" || item === null) {
        return null;
      }
      const candidate = item as Record<string, unknown>;
      const label = typeof candidate.label === "string" ? candidate.label : String.fromCharCode(65 + index);
      const problemId = typeof candidate.problemId === "string" ? candidate.problemId : "";
      const score = typeof candidate.score === "number" ? candidate.score : 100;
      const orderIndex = typeof candidate.orderIndex === "number" ? candidate.orderIndex : index;
      if (!problemId) {
        return null;
      }
      return { label, problemId, score, orderIndex };
    })
    .filter((item): item is ContestProblem => item !== null);
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    const contests = listContestsForListView(user.id);
    return NextResponse.json({ contests });
  } catch (error) {
    return errorResponse(error, "failed to fetch contests");
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const fallbackProblems = listPublicProblems()
      .slice(0, 2)
      .map((problem, index) => ({
        label: String.fromCharCode(65 + index),
        problemId: problem.id,
        score: 100,
        orderIndex: index,
      }));

    const parsedProblems = parseContestProblems(body.problems);

    const contest = await createContest({
      title: parseString(body.title),
      slug: parseString(body.slug),
      descriptionMarkdown: parseString(body.descriptionMarkdown),
      visibility: parseVisibility(body.visibility, "public"),
      startAt: parseString(body.startAt, new Date().toISOString()),
      endAt: parseString(body.endAt, new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()),
      penaltyMinutes: parseNonNegativeNumber(body.penaltyMinutes, 5),
      scoreboardVisibility: parseScoreboardVisibility(body.scoreboardVisibility),
      problems: parsedProblems.length > 0 ? parsedProblems : fallbackProblems,
    });

    return NextResponse.json({ contest }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "contest creation failed");
  }
}
