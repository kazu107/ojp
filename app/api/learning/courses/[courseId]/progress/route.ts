import { NextResponse } from "next/server";
import { getCurrentUser, getOptionalCurrentUser } from "@/lib/store";
import {
  getLearningProgress,
  recordLearningProgress,
} from "@/lib/learning-store";
import {
  learningApiError,
  learningPrivateHeaders,
  readLearningBody,
} from "@/lib/learning-api";

type Context = { params: Promise<{ courseId: string }> };
export async function GET(request: Request, { params }: Context) {
  try {
    const { courseId } = await params;
    return NextResponse.json(
      {
        progress: await getLearningProgress(
          courseId,
          await getOptionalCurrentUser(),
          new URL(request.url).searchParams.get("version") ?? undefined,
        ),
      },
      { headers: learningPrivateHeaders },
    );
  } catch (error) {
    return learningApiError(error);
  }
}
export async function POST(request: Request, { params }: Context) {
  try {
    const user = await getCurrentUser();
    const { courseId } = await params;
    return NextResponse.json(
      await recordLearningProgress(
        courseId,
        user,
        await readLearningBody(request),
      ),
      { headers: learningPrivateHeaders },
    );
  } catch (error) {
    return learningApiError(error);
  }
}
