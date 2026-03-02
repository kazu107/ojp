import { NextResponse } from "next/server";
import { parseString } from "@/lib/api-helpers";
import { errorResponse } from "@/lib/api-response";
import { updateReportStatusByAdmin } from "@/lib/store";

interface ResolveReportRouteContext {
  params: Promise<{
    reportId: string;
  }>;
}

export async function POST(request: Request, { params }: ResolveReportRouteContext) {
  try {
    const { reportId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const report = await updateReportStatusByAdmin(
      reportId,
      "resolved",
      parseString(body.reason, "resolved by admin"),
    );
    return NextResponse.json({ report });
  } catch (error) {
    return errorResponse(error, "failed to resolve report");
  }
}
