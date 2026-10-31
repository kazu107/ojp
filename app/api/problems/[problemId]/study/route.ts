import { readWorkspaceBody } from "@/lib/workspace-json";
import { NextResponse } from "next/server";
import { workspaceProblem, workspaceError } from "@/lib/problem-workspace-access";
import { saveStudy, studyEntry } from "@/lib/problem-workspace-store";
type Context = { params: Promise<{ problemId: string }> };
export async function GET(_request: Request, { params }: Context) {
  try { const { problemId } = await params; const { user } = await workspaceProblem(problemId); return NextResponse.json({ study: await studyEntry(user.id, problemId) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return workspaceError(error); }
}
export async function PUT(request: Request, { params }: Context) {
  try { const { problemId } = await params; const { user } = await workspaceProblem(problemId); return NextResponse.json({ study: await saveStudy(user.id, problemId, await readWorkspaceBody(request)) }); }
  catch (error) { return workspaceError(error); }
}
