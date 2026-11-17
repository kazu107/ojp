
import { getI18n } from "@/lib/i18n/server";
import { redirect } from "next/navigation";
import { ProblemEditorForm } from "@/components/problem-editor-form";
import { canCreateProblemByRole, getOptionalCurrentUser } from "@/lib/store";

export default async function NewProblemPage() {
  const { t } = await getI18n();
  const me = await getOptionalCurrentUser();
  if (!me) redirect("/signin?callbackUrl=%2Fproblems%2Fnew");
  const canCreateProblem = canCreateProblemByRole(me.role);

  return (
    <div className="page">
      <section className="page-head">
        <div>
          <h1 className="page-title">{t("Create Problem")}</h1>
        </div>
      </section>
      <section className="panel">
        {canCreateProblem ? (
          <ProblemEditorForm mode="create" />
        ) : (
          <p className="badge badge-red">
            {t("You need `problem_author` (or admin) role to create problems.")}</p>
        )}
      </section>
    </div>
  );
}
