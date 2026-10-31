import { readWorkspaceBody } from "@/lib/workspace-json";
import { recordCurrentProblemRevision } from "@/lib/store";
import { NextResponse } from "next/server";
import { workspaceProblem, workspaceError } from "@/lib/problem-workspace-access";
import { problemTags, saveProblemTags } from "@/lib/problem-workspace-store";
type Context = { params: Promise<{ problemId: string }> };
export async function GET(_request: Request, { params }: Context) {
  try { const { problemId } = await params; await workspaceProblem(problemId); return NextResponse.json({ tags: (await problemTags([problemId])).get(problemId) ?? [] }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return workspaceError(error); }
}
export async function PUT(request: Request, { params }: Context) {
  try { const { problemId } = await params; const {user,problem}=await workspaceProblem(problemId, true); const body = await readWorkspaceBody(request); await recordCurrentProblemRevision(problem,user.id,"baseline"); const row = await saveProblemTags(problemId, body.tags); await recordCurrentProblemRevision(problem,user.id,"tags"); return NextResponse.json({ tags: row.tags }); }
  catch (error) { return workspaceError(error); }
}
