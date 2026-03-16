import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-response";
import { canCreateProblemByRole, getCurrentUser, HttpError } from "@/lib/store";
import {
  isProblemPackageObjectStorageEnabled,
  putProblemPackageZipStream,
} from "@/lib/problem-package-storage";

const MAX_UPLOAD_BYTES = 256 * 1024 * 1024;

export const runtime = "nodejs";

export async function PUT(request: Request) {
  try {
    const actor = await getCurrentUser();
    if (actor.status !== "active") {
      throw new HttpError("user account is not active", 403);
    }
    if (!canCreateProblemByRole(actor.role)) {
      throw new HttpError("problem creation requires problem_author role", 403);
    }
    if (!isProblemPackageObjectStorageEnabled()) {
      throw new HttpError("R2 is required for streamed package uploads", 400);
    }
    if (!request.body) {
      throw new HttpError("zip request body is required", 400);
    }

    const fileName = request.headers.get("x-ojp-file-name")?.trim();
    const sizeBytes = Number(request.headers.get("x-ojp-file-size") ?? "0");
    if (!fileName) {
      throw new HttpError("x-ojp-file-name header is required", 400);
    }
    if (Number.isFinite(sizeBytes) && sizeBytes > MAX_UPLOAD_BYTES) {
      throw new HttpError(`zip size exceeds limit (${MAX_UPLOAD_BYTES} bytes)`, 400);
    }

    const storageRef = await putProblemPackageZipStream({
      keyPrefix: `temp-packages/${actor.id}`,
      fileName,
      body: Readable.fromWeb(request.body as unknown as NodeReadableStream<Uint8Array>),
      sizeBytes: Number.isFinite(sizeBytes) && sizeBytes > 0 ? sizeBytes : 0,
    });

    return NextResponse.json({ storageRef, fileName }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "failed to upload problem package");
  }
}
