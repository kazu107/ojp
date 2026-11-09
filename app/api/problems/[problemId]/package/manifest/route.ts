import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-response";
import { buildEditorDraftFromExtracted } from "@/lib/problem-package";
import {
  createLazyProblemPackageSourceFromStorageRef,
  buildEditorDraftFromLazySource,
} from "@/lib/problem-package-lazy";
import { isProblemPackageObjectStorageEnabled } from "@/lib/problem-package-storage";
import {
  getCurrentUser,
  getProblemById,
  getProblemPackageData,
  getProblemPackageStorageRef,
  HttpError,
} from "@/lib/store";

interface ProblemPackageManifestRouteContext {
  params: Promise<{
    problemId: string;
  }>;
}

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: ProblemPackageManifestRouteContext,
) {
  try {
    const { problemId } = await params;
    const actor = await getCurrentUser();
    const problem = getProblemById(problemId);
    if (!problem) {
      throw new HttpError("problem not found", 404);
    }
    if (actor.role !== "admin" && problem.authorId !== actor.id) {
      throw new HttpError("you cannot inspect package for this problem", 403);
    }

    const storageRef = getProblemPackageStorageRef(problemId);
    if (storageRef && isProblemPackageObjectStorageEnabled()) {
      const source = await createLazyProblemPackageSourceFromStorageRef({
        ref: storageRef,
        fileName:
          problem.latestPackageSummary?.fileName ?? `${problem.slug}.zip`,
      });
      try {
        return NextResponse.json({
          draft: buildEditorDraftFromLazySource(source),
        });
      } finally {
        await source.cleanup();
      }
    }

    const packageData = await getProblemPackageData(problemId);
    if (!packageData) {
      throw new HttpError("problem package not found", 404);
    }

    const draft = buildEditorDraftFromExtracted(packageData);
    return NextResponse.json({ draft });
  } catch (error) {
    return errorResponse(error, "failed to load package manifest");
  }
}
