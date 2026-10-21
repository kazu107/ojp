
import { getI18n } from "@/lib/i18n/server";
import { redirect } from "next/navigation";
import { getOptionalCurrentUser } from "@/lib/store";
import { canAuthorLearning } from "@/lib/learning-store";
import { LearningCourseEditor } from "@/components/learning-course-editor";

export const dynamic = "force-dynamic";
export default async function NewCoursePage() {
  const { t } = await getI18n();
  const user = await getOptionalCurrentUser();
  if (!user) redirect("/signin?callbackUrl=%2Flearn%2Fnew");
  if (!canAuthorLearning(user))
    return (
      <section className="panel">
        {t("教材作成にはproblem_authorまたはadmin権限が必要です。")}</section>
    );
  return (
    <div className="page">
      <section className="page-head">
        <div>
          <h1 className="page-title">{t("コースを作成")}</h1>
          <p className="page-subtitle">
            {t("サンプルを編集するか、Markdownを取り込んで教材を登録してください。")}</p>
        </div>
      </section>
      <LearningCourseEditor />
    </div>
  );
}
