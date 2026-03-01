import { NextResponse } from "next/server";
import { getCurrentUser, getSubmissionWithAccess } from "@/lib/store";

interface SubmissionRouteContext {
  params: Promise<{
    submissionId: string;
  }>;
}

export async function GET(_request: Request, { params }: SubmissionRouteContext) {
  const { submissionId } = await params;
  const user = getCurrentUser();
  const result = getSubmissionWithAccess(submissionId, user.id);
  if (!result) {
    return NextResponse.json({ error: "submission not found" }, { status: 404 });
  }
  return NextResponse.json({
    submission: result.submission,
    canViewSource: result.canViewSource,
  });
}
