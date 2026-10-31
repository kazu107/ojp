import type { Problem, Submission } from "./types";

export function normalizeTags(value: unknown): string[] {
  const input = typeof value === "string" ? value.normalize("NFKC").split(/[,、\r\n]/) : value;
  if (!Array.isArray(input) || input.length > 20) throw new Error("Use at most 20 tags.");
  const result = new Set<string>();
  for (const item of input) {
    if (typeof item !== "string") throw new Error("Tags must be strings.");
    const tag = item.normalize("NFKC").trim().toLocaleLowerCase("en");
    if (!tag) continue;
    if (/[,、]/.test(tag)) throw new Error("Tags cannot contain separators.");
    if (tag.length > 40 || /[\x00-\x1f<>]/.test(tag)) throw new Error("Each tag must contain 1 to 40 characters without markup.");
    result.add(tag);
  }
  return [...result].sort();
}

export type ProblemProgress = "unattempted" | "attempted" | "solved";
export function reviewIsDue(row: { review: boolean; reviewAt: Date | null }, now = Date.now()): boolean {
  return row.review && (!row.reviewAt || row.reviewAt.getTime() <= now);
}
export function problemProgress(submissions: Pick<Submission, "problemId" | "status">[]): Map<string, ProblemProgress> {
  const result = new Map<string, ProblemProgress>();
  for (const submission of submissions) {
    if (submission.status === "accepted") result.set(submission.problemId, "solved");
    else if (!result.has(submission.problemId)) result.set(submission.problemId, "attempted");
  }
  return result;
}

export interface DiscoveryFilters { q?: string; tag?: string; min?: string; max?: string; progress?: string; saved?: string }
export function filterProblems(problems: Problem[], filters: DiscoveryFilters, tags: Map<string, string[]>, progress: Map<string, ProblemProgress>, saved = new Set<string>()): Problem[] {
  const q = (filters.q ?? "").normalize("NFKC").trim().toLocaleLowerCase("en").slice(0, 200);
  const tag = (filters.tag ?? "").normalize("NFKC").trim().toLocaleLowerCase("en");
  const bound = (raw?: string) => raw && /^-?\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : undefined;
  const min = bound(filters.min), max = bound(filters.max);
  return problems.filter((problem) => {
    const labels = tags.get(problem.id) ?? [];
    return (!q || [problem.title, problem.slug, ...labels].some(text => text.normalize("NFKC").toLocaleLowerCase("en").includes(q))) &&
      (!tag || labels.includes(tag)) && (min === undefined || (problem.difficulty !== null && problem.difficulty >= min)) &&
      (max === undefined || (problem.difficulty !== null && problem.difficulty <= max)) &&
      (!filters.progress || filters.progress === "all" || (progress.get(problem.id) ?? "unattempted") === filters.progress) &&
      (filters.saved !== "1" || saved.has(problem.id));
  });
}
