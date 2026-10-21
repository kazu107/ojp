
import { getI18n } from "@/lib/i18n/server";
import { getCurrentUser } from "@/lib/store";
import { learningCourseForEditor } from "@/lib/learning-store";
import { LearningCourseEditor } from "@/components/learning-course-editor";
import { LearningUnavailable } from "@/components/learning-unavailable";

export const dynamic = "force-dynamic";
export default async function EditCoursePage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { t } = await getI18n();
  const { courseId } = await params;
  const user = await getCurrentUser();
  let initial: Awaited<ReturnType<typeof learningCourseForEditor>>;
  try {
    initial = await learningCourseForEditor(courseId, user);
  } catch (error) {
    return <LearningUnavailable error={error} />;
  }
  return (
    <div className="page">
      <section className="page-head">
        <div>
          <h1 className="page-title">{t("教材を編集")}</h1>
          <p className="page-subtitle">
            {t("下書きを保存しても公開版は変わりません。「保存して公開」で新しい版を公開します。")}</p>
        </div>
      </section>
      <LearningCourseEditor initial={initial} />
    </div>
  );
}
