import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { LearningError, LEARNING_MAX_BODY_BYTES } from "./learning";

export async function readLearningBody(
  request: Request,
): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length")) > LEARNING_MAX_BODY_BYTES)
    throw new LearningError("Request exceeds 2 MiB.", 413);
  if (!request.body) throw new LearningError("Request body is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > LEARNING_MAX_BODY_BYTES) {
        await reader.cancel();
        throw new LearningError("Request exceeds 2 MiB.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new LearningError("Invalid JSON request.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new LearningError("Expected an object.");
  return body as Record<string, unknown>;
}

export function learningApiError(error: unknown) {
  if (
    error instanceof LearningError ||
    (error instanceof Error &&
      "status" in error &&
      typeof error.status === "number")
  ) {
    return NextResponse.json(
      { error: error.message },
      { status: (error as LearningError).status },
    );
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002")
      return NextResponse.json(
        { error: "That course slug already exists." },
        { status: 409 },
      );
    if (error.code === "P2021")
      return NextResponse.json(
        {
          error: "Learning tables are not installed. Run npm run db:learning.",
        },
        { status: 503 },
      );
  }
  console.error(
    "Learning request failed",
    error instanceof Error ? error.name : "Unknown error",
  );
  return NextResponse.json(
    { error: "Learning data could not be loaded or saved. Please try again." },
    { status: 500 },
  );
}

export const learningPrivateHeaders = { "Cache-Control": "private, no-store" };
