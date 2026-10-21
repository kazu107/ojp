import { NextResponse } from "next/server";
import { getCurrentUser, getOptionalCurrentUser } from "@/lib/store";
import { listLearningCourses, saveLearningDraft } from "@/lib/learning-store";
import {
  learningApiError,
  learningPrivateHeaders,
  readLearningBody,
} from "@/lib/learning-api";

export async function GET() {
  try {
    return NextResponse.json(
      { courses: await listLearningCourses(await getOptionalCurrentUser()) },
      { headers: learningPrivateHeaders },
    );
  } catch (error) {
    return learningApiError(error);
  }
}
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    const body = await readLearningBody(request);
    return NextResponse.json(await saveLearningDraft(user, body.draft), {
      status: 201,
    });
  } catch (error) {
    return learningApiError(error);
  }
}
