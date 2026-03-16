import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-response";
import { getPackageJobForViewer } from "@/lib/store";

interface PackageJobRouteContext {
  params: Promise<{
    jobId: string;
  }>;
}

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: PackageJobRouteContext) {
  try {
    const { jobId } = await params;
    const job = await getPackageJobForViewer(jobId);
    return NextResponse.json({
      job:
        job.type === "apply"
          ? {
              id: job.id,
              type: job.type,
              status: job.status,
              createdAt: job.createdAt,
              startedAt: job.startedAt,
              finishedAt: job.finishedAt,
              error: job.error,
              result: job.result,
            }
          : {
              id: job.id,
              type: job.type,
              status: job.status,
              createdAt: job.createdAt,
              startedAt: job.startedAt,
              finishedAt: job.finishedAt,
              error: job.error,
              result: job.result,
            },
    });
  } catch (error) {
    return errorResponse(error, "failed to fetch package job");
  }
}
