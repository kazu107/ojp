import { NextResponse } from "next/server";
import { getOptionalCurrentUser } from "@/lib/store";
import { getLearningItem } from "@/lib/learning-store";
import { learningApiError, learningPrivateHeaders } from "@/lib/learning-api";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ courseId: string; itemId: string }> },
) {
  try {
    const { courseId, itemId } = await params;
    const user = await getOptionalCurrentUser();
    return NextResponse.json(
      await getLearningItem(
        courseId,
        user,
        itemId,
        new URL(request.url).searchParams.get("version") ?? undefined,
      ),
      { headers: learningPrivateHeaders },
    );
  } catch (error) {
    return learningApiError(error);
  }
}
