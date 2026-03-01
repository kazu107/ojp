import { NextResponse } from "next/server";
import { parseString } from "@/lib/api-helpers";
import { errorResponse } from "@/lib/api-response";
import { unfreezeUserByAdmin } from "@/lib/store";

interface UnfreezeUserRouteContext {
  params: Promise<{
    userId: string;
  }>;
}

export async function POST(request: Request, { params }: UnfreezeUserRouteContext) {
  try {
    const { userId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const user = await unfreezeUserByAdmin(userId, parseString(body.reason));
    return NextResponse.json({ user });
  } catch (error) {
    return errorResponse(error, "failed to unfreeze user");
  }
}

