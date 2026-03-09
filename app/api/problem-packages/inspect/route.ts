import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-response";
import { inspectProblemPackage } from "@/lib/problem-package";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "zip file is required (multipart/form-data field: file)" },
        { status: 400 },
      );
    }

    const zipBuffer = Buffer.from(await file.arrayBuffer());
    const inspected = inspectProblemPackage(file.name, zipBuffer);
    return NextResponse.json(inspected, { status: 200 });
  } catch (error) {
    return errorResponse(error, "failed to inspect problem package");
  }
}
