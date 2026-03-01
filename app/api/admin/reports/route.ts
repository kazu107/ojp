import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-response";
import { listReportsForAdmin } from "@/lib/store";

export async function GET() {
  try {
    const reports = await listReportsForAdmin();
    return NextResponse.json({ reports });
  } catch (error) {
    return errorResponse(error, "failed to fetch reports");
  }
}
