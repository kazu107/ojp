
import { getI18n } from "@/lib/i18n/server";
import Link from "next/link";
import { getOptionalCurrentUser } from "@/lib/store";
import {
  canEditLearning,
  getLearningProgress,
  learningVersionForViewer,
} from "@/lib/learning-store";
import { LearningUnavailable } from "@/components/learning-unavailable";

export const dynamic = "force-dynamic";
export default async function CoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  const { t } = await getI18n();
  const { courseId } = await params;
  const { version: versionId } = await searchParams;
  const user = await getOptionalCurrentUser();
  let context: Awaited<ReturnType<typeof learningVersionForViewer>>;
  let progress: Awaited<ReturnType<typeof getLearningProgress>>;
  try {
    context = await learningVersionForViewer(courseId, user, versionId);
    progress = await getLearningProgress(courseId, user, context.version.id);
  } catch (error) {
    return <LearningUnavailable error={error} />;
  }
  const { course, version, outline } = context;
  const completed = new Set(
    progress.filter((entry) => entry.completed).map((entry) => entry.itemId),
  );
  const required = outline.chapters
    .flatMap((chapter) => chapter.items)
    .filter((item) => item.required);
  return (
    <div className="page">
      <section className="page-head">
        <div>
          <h1 className="page-title">{version.title}</h1>
          <p className="page-subtitle">{version.summary}</p>
        </div>
        {canEditLearning(course, user) ? (
          <Link
            href={`/learn/${courseId}/edit`}
            className="button button-secondary"
          >
            {t("教材を編集")}</Link>
        ) : null}
      </section>
      <section className="panel stack">
        <div className="learning-progress-head">
          <h2 className="panel-title">{t("学習進捗")}</h2>
          <span>
            {required.filter((item) => completed.has(item.id)).length} /{" "}
            {required.length} {t(" 完了")}</span>
        </div>
        <progress
          className="learning-progress"
          max={Math.max(1, required.length)}
          value={required.filter((item) => completed.has(item.id)).length}
        />
        <p className="learning-caption">
          {t("進捗は公開版ごとに保存されます。教材の更新後も以前の版の学習URL・進捗は残ります。")}</p>
        {version.id !== course.publishedVersionId ? (
          <Link className="link" href={`/learn/${courseId}`}>
            {t("最新の教材に移動する")}</Link>
        ) : null}
      </section>
      <div className="learning-course-grid">
        {outline.chapters.map((chapter, index) => (
          <section className="panel stack" key={chapter.id}>
            <p className="panel-subtitle">
              {t("章 ")}{index + 1}
            </p>
            <h2 className="panel-title">{chapter.title}</h2>
            <ul className="learning-outline">
              {chapter.items.map((item) => (
                <li key={item.id}>
                  <Link
                    className="link"
                    href={`/learn/${courseId}/chapters/${chapter.id}?version=${version.id}&item=${item.id}`}
                  >
                    {completed.has(item.id) ? "✓ " : ""}
                    {item.title}
                  </Link>
                  <span className="learning-caption">
                    {item.kind === "lesson" ? t("教材") : item.kind === "quiz" ? t("確認クイズ") : t("練習問題")}
                    {item.required ? "" : t("・任意")}
                  </span>
                </li>
              ))}
            </ul>
            <Link
              className="button"
              href={`/learn/${courseId}/chapters/${chapter.id}?version=${version.id}&item=${chapter.items.find((item) => !completed.has(item.id))?.id ?? chapter.items[0].id}`}
            >
              {t("この章を学ぶ")}</Link>
          </section>
        ))}
      </div>
    </div>
  );
}
