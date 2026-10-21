import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/store";
import {
  publishLearningCourse,
  unpublishLearningCourse,
} from "@/lib/learning-store";
import { learningApiError, readLearningBody } from "@/lib/learning-api";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  try {
    const user = await getCurrentUser();
    const { courseId } = await params;
    const body = await readLearningBody(request);
    return NextResponse.json(
      body.unpublish === true
        ? await unpublishLearningCourse(
            user,
            courseId,
            body.editVersion as number,
          )
        : await publishLearningCourse(
            user,
            courseId,
            body.editVersion as number,
          ),
    );
  } catch (error) {
    return learningApiError(error);
  }
}
