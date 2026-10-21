
import { getI18n } from "@/lib/i18n/server";
import Link from "next/link";
import { getOptionalCurrentUser } from "@/lib/store";
import {
  getLearningProgress,
  learningVersionForViewer,
} from "@/lib/learning-store";
import { LearningChapterView } from "@/components/learning-chapter";
import { LearningUnavailable } from "@/components/learning-unavailable";
import { LearningError } from "@/lib/learning";

export const dynamic = "force-dynamic";
export default async function ChapterPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string; chapterId: string }>;
  searchParams: Promise<{ item?: string; version?: string }>;
}) {
  const { t } = await getI18n();
  const { courseId, chapterId } = await params;
  const query = await searchParams;
  const user = await getOptionalCurrentUser();
  let context: Awaited<ReturnType<typeof learningVersionForViewer>>;
  let progress: Awaited<ReturnType<typeof getLearningProgress>>;
  try {
    context = await learningVersionForViewer(courseId, user, query.version);
    progress = await getLearningProgress(courseId, user, context.version.id);
  } catch (error) {
    return <LearningUnavailable error={error} />;
  }
  const { version, outline } = context;
  const chapter = outline.chapters.find((chapter) => chapter.id === chapterId);
  if (!chapter)
    return (
      <LearningUnavailable
        error={new LearningError("Chapter not found.", 404)}
      />
    );
  return (
    <div className="page">
      <section className="page-head">
        <div>
          <Link
            className="link"
            href={`/learn/${courseId}?version=${version.id}`}
          >
            {version.title} {t(" / 章一覧")}</Link>
          <h1 className="page-title learning-chapter-heading">
            {chapter.title}
          </h1>
        </div>
      </section>
      <LearningChapterView
        courseId={courseId}
        versionId={version.id}
        chapter={chapter}
        initialItemId={query.item ?? chapter.items[0].id}
        userId={user?.id ?? null}
        initialProgress={progress}
      />
    </div>
  );
}
