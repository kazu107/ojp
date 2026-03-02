import { NextResponse } from "next/server";
import { paginateItems, parsePaginationQuery } from "@/lib/api-helpers";
import { errorResponse } from "@/lib/api-response";
import { listReportsForAdmin } from "@/lib/store";

export async function GET(request: Request) {
  try {
    const pagination = parsePaginationQuery(new URL(request.url).searchParams, {
      defaultLimit: 50,
      maxLimit: 200,
    });
    const { items: reports, meta } = paginateItems(await listReportsForAdmin(), pagination);
    return NextResponse.json({ reports, pagination: meta });
  } catch (error) {
    return errorResponse(error, "failed to fetch reports");
  }
}
