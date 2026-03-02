import { NextResponse } from "next/server";
import { parseString } from "@/lib/api-helpers";
import { errorResponse } from "@/lib/api-response";
import { hideAnnouncementByAdmin } from "@/lib/store";

interface HideAnnouncementRouteContext {
  params: Promise<{
    announcementId: string;
  }>;
}

export async function POST(request: Request, { params }: HideAnnouncementRouteContext) {
  try {
    const { announcementId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const announcement = await hideAnnouncementByAdmin(
      announcementId,
      parseString(body.reason),
    );
    return NextResponse.json({ announcement });
  } catch (error) {
    return errorResponse(error, "failed to hide announcement");
  }
}
