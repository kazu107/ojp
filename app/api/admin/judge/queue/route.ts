import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-response";
import { getJudgeQueueDiagnosticsForAdmin, repairJudgeQueueByAdmin } from "@/lib/store";

export async function GET() {
  try {
    const diagnostics = await getJudgeQueueDiagnosticsForAdmin();
    return NextResponse.json({ diagnostics });
  } catch (error) {
    return errorResponse(error, "failed to fetch judge queue stats");
  }
}

export async function POST() {
  try {
    const result = await repairJudgeQueueByAdmin();
    return NextResponse.json({ result });
  } catch (error) {
    return errorResponse(error, "failed to repair judge queue");
  }
}
