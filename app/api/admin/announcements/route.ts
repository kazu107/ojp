import { NextResponse } from "next/server";
import { parseString } from "@/lib/api-helpers";
import { errorResponse } from "@/lib/api-response";
import {
  createAnnouncementByAdmin,
  listAnnouncementsForAdmin,
} from "@/lib/store";

export async function GET() {
  try {
    const announcements = await listAnnouncementsForAdmin();
    return NextResponse.json({ announcements });
  } catch (error) {
    return errorResponse(error, "failed to fetch announcements");
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const announcement = await createAnnouncementByAdmin(
      {
        title: parseString(body.title),
        body: parseString(body.body),
      },
      parseString(body.reason),
    );
    return NextResponse.json({ announcement }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "failed to create announcement");
  }
}
