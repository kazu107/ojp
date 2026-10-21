
import { getI18n } from "@/lib/i18n/server";
import Link from "next/link";
import { getOptionalCurrentUser } from "@/lib/store";
import { canAuthorLearning, listLearningCourses } from "@/lib/learning-store";
import { LearningUnavailable } from "@/components/learning-unavailable";

export const dynamic = "force-dynamic";
export default async function LearningPage() {
  const { t } = await getI18n();
  const user = await getOptionalCurrentUser();
  let courses: Awaited<ReturnType<typeof listLearningCourses>>;
  try {
    courses = await listLearningCourses(user);
  } catch (error) {
    return <LearningUnavailable error={error} />;
  }
  return (
    <div className="page">
      <section className="page-head">
        <div>
          <h1 className="page-title">{t("学習")}</h1>
          <p className="page-subtitle">
            {t("教材、確認クイズ、練習問題を章の中で切り替えながら学べます。")}</p>
        </div>
        {canAuthorLearning(user) ? (
          <Link href="/learn/new" className="button">
            {t("コースを作成")}</Link>
        ) : null}
      </section>
      {courses.length ? (
        <div className="learning-course-grid">
          {courses.map((course) => (
            <article
              className="panel stack learning-course-card"
              key={course.id}
            >
              <div className="button-row">
                {course.previousVersionId ? (
                  <Link
                    href={`/learn/${course.id}?version=${course.previousVersionId}`}
                    className="button button-secondary"
                  >
                    {t("以前の版の進捗から再開")}</Link>
                ) : null}
                <span className="badge badge-blue">
                  {course.publishedVersionId ? t("公開版あり") : t("下書き")}
                </span>
                <span className="text-soft">{t(course.visibility)}</span>
              </div>
              <h2 className="panel-title">{course.title}</h2>
              <p className="text-soft">{course.summary}</p>
              {course.total > 0 ? (
                <>
                  <progress
                    className="learning-progress"
                    max={course.total}
                    value={course.completed}
                    aria-label={t("学習進捗")}
                  />
                  <p className="learning-caption">
                    {t("必須項目 ")}{course.completed} / {course.total} {t(" 完了")}</p>
                </>
              ) : null}
              <div className="button-row">
                {course.publishedVersionId ? (
                  <Link href={`/learn/${course.id}`} className="button">
                    {t("学習する")}</Link>
                ) : null}
                {course.canEdit ? (
                  <Link
                    href={`/learn/${course.id}/edit`}
                    className="button button-secondary"
                  >
                    {t("教材を編集")}</Link>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <section className="panel stack">
          <h2 className="panel-title">{t("まだ公開されているコースはありません")}</h2>
          <p className="text-soft">
            {t("教材が登録されると、ここから学習を始められます。")}</p>
        </section>
      )}
    </div>
  );
}
