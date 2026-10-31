import { problemTags } from "@/lib/problem-workspace-store";

import { getI18n } from "@/lib/i18n/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProblemEditorForm } from "@/components/problem-editor-form";
import { VisibilityActionButtons } from "@/components/visibility-action-buttons";
import {
  canEditProblemByViewer,
  getCurrentUser,
  getProblemForViewer,
} from "@/lib/store";

interface EditProblemPageProps {
  params: Promise<{
    problemId: string;
  }>;
}

export default async function EditProblemPage({ params }: EditProblemPageProps) {
  const { t } = await getI18n();
  const { problemId } = await params;
  const me = await getCurrentUser();
  const problem = getProblemForViewer(problemId, me.id);
  if (!problem) {
    notFound();
  }

  const canEdit = canEditProblemByViewer(problem, me.id);
  const tags=canEdit ? (await problemTags([problem.id])).get(problem.id) ?? [] : [];

  return (
    <div className="page">
      <section className="page-head">
        <div>
          <h1 className="page-title">{t("Edit Problem")}</h1>
          <p className="page-subtitle">
            {t("Update statement, limits, and the judge package, including manual test groups and ZIP import.")}</p>
        </div>
      </section>

      {canEdit ? (
        <>
          <section className="panel">
            <ProblemEditorForm mode="edit" initialProblem={problem} initialTags={tags} />
          </section>
          <section className="panel stack">
            <h2 className="panel-title">{t("Publish Settings")}</h2>
            <p className="panel-subtitle">
              {t("Publish makes this problem public. Unpublish makes it private.")}</p>
            <VisibilityActionButtons
              resourceType="problem"
              resourceId={problem.id}
              visibility={problem.visibility}
            />
          </section>
        </>
      ) : (
        <section className="panel stack">
          <p className="badge badge-red">{t("You do not have permission to edit this problem.")}</p>
          <div className="button-row">
            <Link href={`/problems/${problem.id}`} className="button button-secondary">
              {t("Back to Problem")}</Link>
          </div>
        </section>
      )}
    </div>
  );
}
