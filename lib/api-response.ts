import { NextResponse } from "next/server";
import { HttpError } from "@/lib/store";

export function errorResponse(error: unknown, fallbackMessage: string) {
  if (error instanceof HttpError) {
    const headers: Record<string, string> = {};
    if (typeof error.retryAfterSeconds === "number") {
      headers["Retry-After"] = String(error.retryAfterSeconds);
    }
    return NextResponse.json(
      { error: error.message },
      {
        status: error.status,
        headers,
      },
    );
  }

  return NextResponse.json(
    {
      error: error instanceof Error ? error.message : fallbackMessage,
    },
    { status: 400 },
  );
}
