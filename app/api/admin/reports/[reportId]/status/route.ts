import { NextResponse } from "next/server";
import { parseString } from "@/lib/api-helpers";
import { errorResponse } from "@/lib/api-response";
import { updateReportStatusByAdmin } from "@/lib/store";
import { ReportStatus } from "@/lib/types";

interface UpdateReportStatusRouteContext {
  params: Promise<{
    reportId: string;
  }>;
}

function parseReportStatus(raw: unknown): ReportStatus {
  if (
    raw === "open" ||
    raw === "investigating" ||
    raw === "resolved" ||
    raw === "dismissed"
  ) {
    return raw;
  }
  return "open";
}

export async function POST(request: Request, { params }: UpdateReportStatusRouteContext) {
  try {
    const { reportId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const report = updateReportStatusByAdmin(
      reportId,
      parseReportStatus(body.status),
      parseString(body.reason),
    );
    return NextResponse.json({ report });
  } catch (error) {
    return errorResponse(error, "failed to update report status");
  }
}
