import { readWorkspaceBody } from "@/lib/workspace-json";
import { NextResponse } from "next/server";
import { workspaceProblem, workspaceError } from "@/lib/problem-workspace-access";
import { getProblemPackageStorageRef, getProblemPackageData, restoreProblemRevision } from "@/lib/store";
import { listProblemRevisions, makeRevisionSnapshot, revisionDigest } from "@/lib/problem-revisions";
import { problemTags } from "@/lib/problem-workspace-store";
type Context = { params: Promise<{ problemId: string }> };
export async function GET(request: Request, { params }: Context) {
  try {
    const { problemId } = await params;
    const { problem } = await workspaceProblem(problemId, true);
    const ref = getProblemPackageStorageRef(problemId) ?? null;
    const tags = (await problemTags([problemId])).get(problemId) ?? [];
    const snapshot = makeRevisionSnapshot(problem, ref, ref ? null : await getProblemPackageData(problemId) ?? null, tags);
    return NextResponse.json({ ...await listProblemRevisions(problemId, new URL(request.url).searchParams.get("cursor") ?? undefined), currentDigest: revisionDigest(snapshot) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return workspaceError(error); }
}
export async function POST(request: Request, { params }: Context) {
  try {
    const { problemId } = await params;
    await workspaceProblem(problemId, true);
    const body = await readWorkspaceBody(request);
    if (typeof body.revisionId !== "string" || body.revisionId.length > 80) throw new Error("Invalid problem revision.");
    return NextResponse.json({ problem: await restoreProblemRevision(problemId, body.revisionId) });
  } catch (error) { return workspaceError(error); }
}
