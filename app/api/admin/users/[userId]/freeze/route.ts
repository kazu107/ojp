import { NextResponse } from "next/server";
import { parseString } from "@/lib/api-helpers";
import { errorResponse } from "@/lib/api-response";
import { freezeUserByAdmin } from "@/lib/store";

interface FreezeUserRouteContext {
  params: Promise<{
    userId: string;
  }>;
}

export async function POST(request: Request, { params }: FreezeUserRouteContext) {
  try {
    const { userId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const user = freezeUserByAdmin(userId, parseString(body.reason));
    return NextResponse.json({ user });
  } catch (error) {
    return errorResponse(error, "failed to freeze user");
  }
}
