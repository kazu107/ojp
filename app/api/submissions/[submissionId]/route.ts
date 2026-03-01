import { NextResponse } from "next/server";
import { getOptionalCurrentUser, getSubmissionWithAccess } from "@/lib/store";
import { errorResponse } from "@/lib/api-response";

interface SubmissionRouteContext {
  params: Promise<{
    submissionId: string;
  }>;
}

export async function GET(_request: Request, { params }: SubmissionRouteContext) {
  try {
    const { submissionId } = await params;
    const user = await getOptionalCurrentUser();
    const result = getSubmissionWithAccess(submissionId, user?.id ?? "guest");
    if (!result) {
      return NextResponse.json({ error: "submission not found" }, { status: 404 });
    }
    return NextResponse.json({
      submission: result.submission,
      canViewSource: result.canViewSource,
    });
  } catch (error) {
    return errorResponse(error, "failed to fetch submission");
  }
}
