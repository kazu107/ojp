import { Prisma } from "@prisma/client";
import { apiError, errorResponse } from "./api-response";
import { getCurrentUser, getProblemForViewer, canEditProblemByViewer, HttpError } from "./store";
import { WorkspaceBodyError } from "./workspace-json";

export async function workspaceProblem(problemId: string, edit = false) {
  const user = await getCurrentUser();
  if (user.status !== "active") throw new HttpError("user account is not active", 403);
  const problem = getProblemForViewer(problemId, user.id);
  if (!problem) throw new HttpError("problem not found", 404);
  if (edit && !canEditProblemByViewer(problem, user.id)) throw new HttpError("you cannot edit this problem", 403);
  return { user, problem };
}

export function workspaceError(error: unknown) {
  if (error instanceof WorkspaceBodyError) return apiError(error.status, error.message);
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") return apiError(503, "Workspace features require database setup. Run npm run db:workspace-features.");
  return errorResponse(error, "workspace request failed");
}
