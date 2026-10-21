import { NextResponse } from "next/server";
import {
  paginateItems,
  parsePaginationQuery,
} from "@/lib/api-helpers";
import {
  createContest,
  getOptionalCurrentUser,
  listContestsForListView,
} from "@/lib/store";
import { newContestInput } from "@/lib/contest-api";
import { errorResponse } from "@/lib/api-response";

export async function GET(request: Request) {
  try {
    const user = await getOptionalCurrentUser();
    const pagination = parsePaginationQuery(new URL(request.url).searchParams, {
      defaultLimit: 50,
      maxLimit: 200,
    });
    const { items: contests, meta } = paginateItems(
      listContestsForListView(user?.id ?? "guest"),
      pagination,
    );
    return NextResponse.json({ contests, pagination: meta });
  } catch (error) {
    return errorResponse(error, "failed to fetch contests");
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const contest = await createContest(newContestInput(body));

    return NextResponse.json({ contest }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "contest creation failed");
  }
}
