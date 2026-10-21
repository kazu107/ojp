import { NextResponse } from "next/server";
import { getCurrentUser, getOptionalCurrentUser } from "@/lib/store";
import {
  canEditLearning,
  getLearningProgress,
  learningCourseForEditor,
  learningVersionForViewer,
  saveLearningDraft,
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
    const query = new URL(request.url).searchParams;
    const user = await getOptionalCurrentUser();
    if (query.get("edit") === "1") {
      return NextResponse.json(
        await learningCourseForEditor(courseId, await getCurrentUser()),
        { headers: learningPrivateHeaders },
      );
    }
    const { course, version, outline } = await learningVersionForViewer(
      courseId,
      user,
      query.get("version") ?? undefined,
    );
    return NextResponse.json(
      {
        courseId,
        versionId: version.id,
        title: version.title,
        summary: version.summary,
        publishedAt: version.createdAt.toISOString(),
        outline,
        canEdit: canEditLearning(course, user),
        progress: await getLearningProgress(courseId, user, version.id),
      },
      { headers: learningPrivateHeaders },
    );
  } catch (error) {
    return learningApiError(error);
  }
}
export async function PUT(request: Request, { params }: Context) {
  try {
    const user = await getCurrentUser();
    const { courseId } = await params;
    const body = await readLearningBody(request);
    return NextResponse.json(
      await saveLearningDraft(
        user,
        body.draft,
        courseId,
        body.editVersion as number,
      ),
    );
  } catch (error) {
    return learningApiError(error);
  }
}
