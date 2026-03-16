import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-response";
import { createLazyProblemPackageSourceFromStorageRef } from "@/lib/problem-package-lazy";
import { isProblemPackageObjectStorageEnabled } from "@/lib/problem-package-storage";
import {
  getOptionalCurrentUser,
  getProblemForViewer,
  getProblemPackageData,
  getProblemPackageStorageRef,
  HttpError,
} from "@/lib/store";

interface ProblemSamplesRouteContext {
  params: Promise<{
    problemId: string;
  }>;
}

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: ProblemSamplesRouteContext) {
  try {
    const { problemId } = await params;
    const me = await getOptionalCurrentUser();
    const viewerId = me?.id ?? "guest";
    const problem = getProblemForViewer(problemId, viewerId);
    if (!problem) {
      throw new HttpError("problem not found", 404);
    }

    if (problem.sampleCases.length > 0) {
      return NextResponse.json({ samples: problem.sampleCases });
    }

    const storageRef = getProblemPackageStorageRef(problemId);
    if (storageRef && isProblemPackageObjectStorageEnabled()) {
      const source = await createLazyProblemPackageSourceFromStorageRef({
        ref: storageRef,
        fileName: problem.latestPackageSummary?.fileName ?? `${problem.slug}.zip`,
      });
      const samples = source.manifest.sampleCases;
      await source.cleanup();
      return NextResponse.json({ samples });
    }

    const packageData = await getProblemPackageData(problemId);
    return NextResponse.json({
      samples:
        packageData?.samples.map((sample) => ({
          name: sample.name,
          description: sample.description,
          input: sample.input,
          output: sample.output,
        })) ?? [],
    });
  } catch (error) {
    return errorResponse(error, "failed to load problem samples");
  }
}
