import { NextResponse } from "next/server";
import { parseString } from "@/lib/api-helpers";
import { errorResponse } from "@/lib/api-response";
import { requestRejudge } from "@/lib/store";

interface RejudgeRouteContext {
  params: Promise<{
    submissionId: string;
  }>;
}

export async function POST(request: Request, { params }: RejudgeRouteContext) {
  try {
    const { submissionId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const result = await requestRejudge({
      submissionId,
      reason: parseString(body.reason),
      detail: parseString(body.detail),
    });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, "rejudge request failed");
  }
}
