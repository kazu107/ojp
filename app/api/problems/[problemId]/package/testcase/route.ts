import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-response";
import { createLazyProblemPackageSourceFromStorageRef } from "@/lib/problem-package-lazy";
import { isProblemPackageObjectStorageEnabled } from "@/lib/problem-package-storage";
import {
  getCurrentUser,
  getProblemById,
  getProblemPackageData,
  getProblemPackageStorageRef,
  HttpError,
} from "@/lib/store";

interface ProblemPackageTestCaseRouteContext {
  params: Promise<{
    problemId: string;
  }>;
}

export const runtime = "nodejs";

export async function GET(request: Request, { params }: ProblemPackageTestCaseRouteContext) {
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

    const url = new URL(request.url);
    const groupName = url.searchParams.get("groupName")?.trim() ?? "";
    const caseName = url.searchParams.get("caseName")?.trim() ?? "";
    if (!groupName || !caseName) {
      throw new HttpError("groupName and caseName are required", 400);
    }

    const storageRef = getProblemPackageStorageRef(problemId);
    if (storageRef && isProblemPackageObjectStorageEnabled()) {
      const source = await createLazyProblemPackageSourceFromStorageRef({
        ref: storageRef,
        fileName: problem.latestPackageSummary?.fileName ?? `${problem.slug}.zip`,
      });
      const testCase = await source.readTestCase(groupName, caseName);
      await source.cleanup();
      return NextResponse.json({ testCase });
    }

    const packageData = await getProblemPackageData(problemId);
    if (!packageData) {
      throw new HttpError("problem package not found", 404);
    }

    const group = packageData.groups.find((entry) => entry.name === groupName);
    const testCase = group?.tests.find((entry) => entry.name === caseName);
    if (!testCase) {
      throw new HttpError("test case not found", 404);
    }
    return NextResponse.json({ testCase });
  } catch (error) {
    return errorResponse(error, "failed to load package test case");
  }
}
