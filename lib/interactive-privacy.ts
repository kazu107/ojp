import type { SubmissionTestResult } from "./types";

export function canViewPrivateInteraction(viewer: { id: string; role: string } | undefined, authorId?: string): boolean {
  return Boolean(viewer && (viewer.role === "admin" || viewer.id === authorId));
}

export function visibleInteractionResults(results: SubmissionTestResult[], canViewPrivate: boolean): SubmissionTestResult[] {
  if (canViewPrivate) return results;
  return results.map((result) => {
    const { interactionLog, ...publicResult } = result;
    void interactionLog;
    return publicResult;
  });
}
