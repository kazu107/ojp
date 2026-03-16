import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-response";
import { buildEditorDraftFromExtracted } from "@/lib/problem-package";
import { createLazyProblemPackageSourceFromStorageRef } from "@/lib/problem-package-lazy";
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

export async function GET(_request: Request, { params }: ProblemPackageManifestRouteContext) {
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
        fileName: problem.latestPackageSummary?.fileName ?? `${problem.slug}.zip`,
      });
      const draft = {
        sourceLabel: source.manifest.validation.fileName,
        checkerType: source.manifest.checkerType,
        checkerLanguage: source.manifest.checkerLanguage ?? "python",
        checkerSourceCode: source.checkerSourceCode ?? "",
        compareMode: source.manifest.compareMode,
        zipSizeBytes: source.manifest.validation.zipSizeBytes,
        fileCount: source.manifest.validation.fileCount,
        isPartial: true,
        samples: source.manifest.sampleCases.map((sample, sampleIndex) => ({
          id: `sample-${sampleIndex + 1}`,
          name: sample.name,
          description: sample.description,
          input: sample.input,
          output: sample.output,
        })),
        warnings: [...source.manifest.validation.warnings],
        groups: source.groups.map((group, groupIndex) => ({
          id: `group-${groupIndex + 1}`,
          name: group.name,
          score: source.manifest.scoringType === "sum_of_groups" ? group.score : null,
          tests: group.caseNames.map((caseName, caseIndex) => ({
            id: `group-${groupIndex + 1}-case-${caseIndex + 1}`,
            name: caseName,
            input: "",
            output: "",
            isLoaded: false,
          })),
        })),
      };
      await source.cleanup();
      return NextResponse.json({ draft });
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
