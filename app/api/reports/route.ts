import { NextResponse } from "next/server";
import { parseString } from "@/lib/api-helpers";
import { errorResponse } from "@/lib/api-response";
import { createReport } from "@/lib/store";
import { ReportTargetType } from "@/lib/types";

function parseTargetType(raw: unknown): ReportTargetType {
  if (raw === "problem" || raw === "contest" || raw === "submission") {
    return raw;
  }
  return "problem";
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const report = await createReport({
      targetType: parseTargetType(body.targetType),
      targetId: parseString(body.targetId),
      reason: parseString(body.reason),
      detail: parseString(body.detail),
    });
    return NextResponse.json({ report }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "report creation failed");
  }
}
