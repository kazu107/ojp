import type { Problem } from "./types";
import { getProblemPackageStorageRef, getProblemPackageData } from "./store";
import { createLazyProblemPackageSourceFromStorageRef } from "./problem-package-lazy";

export async function loadPublicBoardSamples(
  problem: Problem,
): Promise<Problem> {
  if (problem.heuristic?.visualizer !== "board" || problem.sampleCases.length)
    return problem;
  const ref = getProblemPackageStorageRef(problem.id);
  if (ref) {
    const source = await createLazyProblemPackageSourceFromStorageRef({
      ref,
      fileName: problem.latestPackageSummary?.fileName ?? "package.zip",
    });
    try {
      return {
        ...problem,
        sampleCases: source.manifest.sampleCases.filter(
          (s) => s.input.length <= 8192 && s.output.length <= 262144,
        ),
      };
    } finally {
      await source.cleanup();
    }
  }
  const data = await getProblemPackageData(problem.id);
  return {
    ...problem,
    sampleCases: (data?.samples ?? []).filter(
      (s) => s.input.length <= 8192 && s.output.length <= 262144,
    ),
  };
}
