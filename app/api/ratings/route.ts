import { NextResponse } from "next/server";
import {
  findUser,
  getOptionalCurrentUser,
  getRatingStatistics,
} from "@/lib/store";
import { errorResponse } from "@/lib/api-response";

export async function GET() {
  try {
    await getOptionalCurrentUser();
    const result = await getRatingStatistics();
    return NextResponse.json(
      {
        ratings: [...result.ratings]
          .map(([userId, rating]) => ({
            userId,
            displayName: findUser(userId)?.displayName ?? userId,
            rating,
            contests: result.history.filter((item) => item.userId === userId)
              .length,
          }))
          .sort(
            (a, b) => b.rating - a.rating || a.userId.localeCompare(b.userId),
          ),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error, "failed to fetch ratings");
  }
}
