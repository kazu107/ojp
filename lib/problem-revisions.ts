import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./db/prisma";
import type { Problem } from "./types";
import type { ProblemPackageStorageRef } from "./problem-package-storage";
import type { ProblemPackageExtracted } from "./problem-package";
import { problemTags } from "./problem-workspace-store";
import { WorkspaceError } from "./workspace-error";

export interface RevisionSnapshot { problem: Problem; tags: string[]; storageRef: ProblemPackageStorageRef | null; inlinePackage: ProblemPackageExtracted | null }
type Summary = Record<string, { digest: string; value: string }>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
  return value;
}
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
function snippet(value: unknown): string {
  let result = "", count = 0;
  for (const character of String(value)) { if (count++ === 400) break; result += character; }
  return result;
}

export function makeRevisionSnapshot(problem: Problem, storageRef: ProblemPackageStorageRef | null, inlinePackage: ProblemPackageExtracted | null, tags: string[] = []): RevisionSnapshot {
  return JSON.parse(JSON.stringify({ problem: { ...problem, sampleCases: storageRef ? [] : problem.sampleCases }, tags: [...tags].sort(), storageRef, inlinePackage: storageRef ? null : inlinePackage }));
}
export function revisionDigest(snapshot: RevisionSnapshot): string {
  const normalized = structuredClone(snapshot);
  normalized.problem.updatedAt = "";
  if (normalized.problem.latestPackageSummary) normalized.problem.latestPackageSummary.validatedAt = "";
  return hash(normalized);
}
export function revisionSummary(snapshot: RevisionSnapshot): Summary {
  const result: Summary = {};
  for (const key of ["title", "slug", "statementMarkdown", "inputDescription", "outputDescription", "constraintsMarkdown", "explanationMarkdown", "visibility", "explanationVisibility", "difficulty", "timeLimitMs", "memoryLimitMb", "testCaseVisibility", "judgeType"] as const) {
    const value = snapshot.problem[key] ?? "";
    result[key] = { digest: hash(value), value: snippet(value) };
  }
  result.tags = { digest: hash(snapshot.tags), value: snapshot.tags.join(", ") };
  const packageHash = hash(snapshot.storageRef ?? snapshot.inlinePackage);
  result.package = { digest: packageHash, value: `${snapshot.problem.latestPackageSummary?.fileName ?? "-"} (${snapshot.problem.latestPackageSummary?.totalTestPairs ?? 0}) [${packageHash.slice(0, 12)}]` };
  return result;
}
export function revisionChanges(before: Summary, after: Summary) {
  return Object.keys(after).filter(key => before[key]?.digest !== after[key].digest).map(field => ({ field, before: before[field]?.value ?? "", after: after[field].value }));
}

export async function captureProblemRevision(problem: Problem, ref: ProblemPackageStorageRef | null, inline: ProblemPackageExtracted | null, actorId: string, kind: string) {
  const snapshot = makeRevisionSnapshot(problem, ref, inline);
  snapshot.tags = (await problemTags([problem.id])).get(problem.id) ?? [];
  const digest = revisionDigest(snapshot);
  try { return await prisma.problemRevision.upsert({
    where: { problemId_digest: { problemId: problem.id, digest } }, update: {},
    create: { id: randomUUID(), problemId: problem.id, digest, snapshot: snapshot as unknown as Prisma.InputJsonValue, summary: revisionSummary(snapshot), storageKey: ref?.key ?? null, createdBy: actorId, kind },
  }); } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.problemRevision.findUnique({ where: { problemId_digest: { problemId: problem.id, digest } } });
      if (existing) return existing;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2021", "P2022"].includes(error.code)) throw new WorkspaceError("Workspace features require database setup. Run npm run db:workspace-features.");
    throw new WorkspaceError("Version storage is temporarily unavailable. Please retry.");
  }
}

export async function revisionById(problemId: string, id: string): Promise<RevisionSnapshot | null> {
  const row = await prisma.problemRevision.findFirst({ where: { id, problemId } });
  if (!row) return null;
  const snapshot = row.snapshot as unknown as RevisionSnapshot;
  if (snapshot.problem?.id !== problemId) throw new Error("Invalid problem revision.");
  return snapshot;
}

export async function listProblemRevisions(problemId: string, cursor?: string) {
  if (cursor && !(await prisma.problemRevision.findFirst({ where: { id: cursor, problemId }, select: { id: true } }))) throw new Error("Invalid revision cursor.");
  const rows = await prisma.problemRevision.findMany({ where: { problemId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 51,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, createdAt: true, createdBy: true, kind: true, digest: true, summary: true } });
  return { revisions: rows.slice(0, 50).map((row, index) => ({ ...row, summary: undefined, changes: revisionChanges((rows[index + 1]?.summary ?? {}) as Summary, row.summary as Summary) })), nextCursor: rows.length > 50 ? rows[49].id : null };
}

export async function retainedPackage(ref: ProblemPackageStorageRef): Promise<boolean> {
  return (await prisma.problemRevision.count({ where: { storageKey: ref.key } })) > 0;
}
