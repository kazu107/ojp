
import { getI18n } from "@/lib/i18n/server";
import Link from "next/link";
import { listLearningCourses } from "@/lib/learning-store";
import type { User } from "@/lib/types";

export async function LearningProfileSummary({ user }: { user: User }) {
  const { t } = await getI18n();
  let courses: Awaited<ReturnType<typeof listLearningCourses>>;
  try {
    courses = (await listLearningCourses(user)).filter(
      (course) => course.completed > 0 || course.previousVersionId,
    );
  } catch {
    return null;
  } // An uninstalled learning schema must not break existing profiles.
  return (
    <section className="panel stack">
      <div className="learning-progress-head">
        <h2 className="panel-title">{t("学習モード")}</h2>
        <Link className="link" href="/learn">
          {t("コース一覧")}</Link>
      </div>
      {courses.length ? (
        courses.map((course) => (
          <div className="learning-progress-head" key={course.id}>
            <Link
              className="link"
              href={
                course.completed > 0
                  ? `/learn/${course.id}`
                  : `/learn/${course.id}?version=${course.previousVersionId}`
              }
            >
              {course.title}
            </Link>
            <span>
              {course.completed > 0 ? t("{value0} / {value1} 完了", { value0: course.completed, value1: course.total }) : t("以前の版：{value0} / {value1} 完了", { value0: course.previousCompleted, value1: course.previousTotal })}
            </span>
          </div>
        ))
      ) : (
        <p className="text-soft">
          {t("教材の読了・クイズ合格・練習問題のACをここで確認できます。")}</p>
      )}
    </section>
  );
}
