import { NextResponse } from "next/server";
import { paginateItems, parsePaginationQuery } from "@/lib/api-helpers";
import { errorResponse } from "@/lib/api-response";
import { getOptionalCurrentUser, listAnnouncementsForViewer } from "@/lib/store";

export async function GET(request: Request) {
  try {
    const user = await getOptionalCurrentUser();
    const pagination = parsePaginationQuery(new URL(request.url).searchParams, {
      defaultLimit: 20,
      maxLimit: 100,
    });
    const { items: announcements, meta } = paginateItems(
      listAnnouncementsForViewer(user?.id ?? "guest"),
      pagination,
    );
    return NextResponse.json({ announcements, pagination: meta });
  } catch (error) {
    return errorResponse(error, "failed to fetch announcements");
  }
}
