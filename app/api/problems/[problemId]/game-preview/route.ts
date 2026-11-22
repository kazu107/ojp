import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-response";
import { readGamePreviewRequest } from "@/lib/grid-game-preview";
import { loadHeuristicContestProblem } from "@/lib/heuristic-store";
import {
  getCurrentUser,
  getProblemForViewer,
  getProblemForContestViewer,
  createGridGamePreviewJob,
  HttpError,
} from "@/lib/store";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ problemId: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (user.status !== "active")
      throw new HttpError("user account is not active", 403);
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin)
      throw new HttpError("Cross-origin game previews are not allowed", 403);
    let body: Awaited<ReturnType<typeof readGamePreviewRequest>>;
    try {
      body = await readGamePreviewRequest(request);
    } catch (error) {
      throw new HttpError(
        error instanceof Error ? error.message : "Invalid request",
        400,
      );
    }
    const { problemId } = await params;
    let problem = body.contestId
      ? getProblemForContestViewer(problemId, body.contestId, user.id)
      : getProblemForViewer(problemId, user.id);
    if (!problem) throw new HttpError("problem not found", 404);
    if (body.contestId && problem.heuristic) {
      const pinned = await loadHeuristicContestProblem(
        body.contestId,
        problemId,
      );
      if (pinned) problem = pinned.problem;
    }
    if (!problem.heuristic?.game)
      throw new HttpError("This problem is not a grid game", 400);
    const job = await createGridGamePreviewJob({
      problem,
      input: body.input,
      language: body.language,
      sourceCode: body.sourceCode,
    });
    return NextResponse.json(
      { job },
      { status: 202, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error, "Unable to start game preview");
  }
}
