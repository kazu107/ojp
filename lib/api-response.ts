import { NextResponse } from "next/server";
import { HttpError } from "@/lib/store";

function statusToCode(status: number): string {
  if (status === 400) {
    return "bad_request";
  }
  if (status === 401) {
    return "unauthorized";
  }
  if (status === 403) {
    return "forbidden";
  }
  if (status === 404) {
    return "not_found";
  }
  if (status === 409) {
    return "conflict";
  }
  if (status === 429) {
    return "rate_limited";
  }
  if (status >= 500) {
    return "internal_error";
  }
  return "error";
}

export function apiError(status: number, message: string, details?: unknown) {
  return NextResponse.json(
    {
      code: statusToCode(status),
      message,
      error: message,
      details,
    },
    { status },
  );
}

export function errorResponse(error: unknown, fallbackMessage: string) {
  if (error instanceof HttpError) {
    const headers: Record<string, string> = {};
    if (typeof error.retryAfterSeconds === "number") {
      headers["Retry-After"] = String(error.retryAfterSeconds);
    }
    return NextResponse.json(
      {
        code: statusToCode(error.status),
        message: error.message,
        error: error.message,
        details:
          typeof error.retryAfterSeconds === "number"
            ? { retryAfterSeconds: error.retryAfterSeconds }
            : undefined,
      },
      {
        status: error.status,
        headers,
      },
    );
  }

  const message = error instanceof Error ? error.message : fallbackMessage;
  return NextResponse.json(
    {
      code: "bad_request",
      message,
      error: message,
    },
    { status: 400 },
  );
}
