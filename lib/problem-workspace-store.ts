import { prisma } from "./db/prisma";
import { Prisma } from "@prisma/client";
import { normalizeTags } from "./problem-discovery";
import type { Submission } from "./types";

function missing(error: unknown): boolean { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021"; }

export async function discoveryStatuses(submissions: Submission[]) {
  const statuses = new Map<string, Submission["status"]>();
  try {
    for (let index = 0; index < submissions.length; index += 500) {
      const rows = await prisma.submissionRuntimeState.findMany({ where: { submissionId: { in: submissions.slice(index, index + 500).map(row => row.id) } }, select: { submissionId: true, status: true } });
      for (const row of rows) statuses.set(row.submissionId, row.status);
    }
  } catch (error) { if (!missing(error)) throw error; }
  return submissions.map(row => ({ problemId: row.problemId, status: statuses.get(row.id) ?? row.status }));
}

export async function problemTags(ids: string[]): Promise<Map<string, string[]>> {
  if (!ids.length) return new Map();
  try { return new Map((await prisma.problemTags.findMany({ where: { problemId: { in: ids } } })).map(row => [row.problemId, row.tags])); }
  catch (error) { if (missing(error)) return new Map(); throw error; }
}

export async function saveProblemTags(problemId: string, raw: unknown) {
  const tags = normalizeTags(raw);
  return prisma.problemTags.upsert({ where: { problemId }, create: { problemId, tags }, update: { tags } });
}

export async function studyEntries(userId: string) {
  try { return await prisma.problemStudy.findMany({ where: { userId, OR: [{bookmarked:true},{review:true},{notes:{not:""}}] }, select: { problemId: true, bookmarked: true, review: true, reviewAt: true, updatedAt: true }, orderBy: { updatedAt: "desc" } }); }
  catch (error) { if (missing(error)) return []; throw error; }
}

export async function studyEntry(userId: string, problemId: string) {
  try { return await prisma.problemStudy.findUnique({ where: { userId_problemId: { userId, problemId } } }); }
  catch (error) { if (missing(error)) return null; throw error; }
}

export function studyPatch(raw: Record<string, unknown>) {
  const result: { bookmarked?: boolean; review?: boolean; notes?: string; reviewAt?: Date | null; lastReviewedAt?: Date } = {};
  for (const key of ["bookmarked", "review"] as const) {
    if (raw[key] !== undefined) { if (typeof raw[key] !== "boolean") throw new Error(`${key} must be boolean`); result[key] = raw[key]; }
  }
  if (raw.notes !== undefined) {
    if (typeof raw.notes !== "string" || raw.notes.length > 10000) throw new Error("Notes must be at most 10000 characters.");
    result.notes = raw.notes;
  }
  if (raw.reviewAt !== undefined) {
    if (raw.reviewAt === null || raw.reviewAt === "") result.reviewAt = null;
    else {
      if (typeof raw.reviewAt !== "string" || !Number.isFinite(Date.parse(raw.reviewAt))) throw new Error("Invalid review date.");
      result.reviewAt = new Date(raw.reviewAt);
    }
  }
  if (raw.reviewed === true) { result.lastReviewedAt = new Date(); result.review = false; result.reviewAt = null; }
  return result;
}

export function saveStudy(userId: string, problemId: string, raw: Record<string, unknown>) {
  const patch = studyPatch(raw);
  return prisma.problemStudy.upsert({ where: { userId_problemId: { userId, problemId } }, create: { userId, problemId, ...patch }, update: patch });
}
