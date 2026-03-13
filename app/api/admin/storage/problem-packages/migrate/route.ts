import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-response";
import { migrateProblemPackagesToObjectStorageByAdmin } from "@/lib/store";

export async function POST() {
  try {
    const result = await migrateProblemPackagesToObjectStorageByAdmin();
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return errorResponse(error, "failed to migrate problem packages to object storage");
  }
}
