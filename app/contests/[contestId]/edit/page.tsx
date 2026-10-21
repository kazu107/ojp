
import { getI18n } from "@/lib/i18n/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ContestEditorForm } from "@/components/contest-editor-form";
import { VisibilityActionButtons } from "@/components/visibility-action-buttons";
import {
  canEditContestByViewer,
  getContestForViewer,
  getContestStatus,
  getCurrentUser,
  listProblemsForListView,
} from "@/lib/store";

interface EditContestPageProps {
  params: Promise<{
    contestId: string;
  }>;
}

export default async function EditContestPage({ params }: EditContestPageProps) {
  const { t } = await getI18n();
  const { contestId } = await params;
  const me = await getCurrentUser();
  const contest = getContestForViewer(contestId, me.id);
  if (!contest) {
    notFound();
  }

  const canEdit = canEditContestByViewer(contest, me.id);
  const availableProblems = listProblemsForListView(me.id);

  return (
    <div className="page">
      <section className="page-head">
        <div>
          <h1 className="page-title">{t("Edit Contest")}</h1>
          <p className="page-subtitle">{t("Update contest window, settings, and problem set.")}</p>
        </div>
      </section>

      {canEdit ? (
        <>
          <section className="panel">
            <ContestEditorForm
              mode="edit"
              initialContest={contest}
              structureLocked={getContestStatus(contest) !== "scheduled"}
              availableProblems={availableProblems}
            />
          </section>
          <section className="panel stack">
            <h2 className="panel-title">{t("Publish Settings")}</h2>
            <p className="panel-subtitle">
              {t("Publish makes this contest public. Unpublish makes it private.")}</p>
            <VisibilityActionButtons
              resourceType="contest"
              resourceId={contest.id}
              visibility={contest.visibility}
            />
          </section>
        </>
      ) : (
        <section className="panel stack">
          <p className="badge badge-red">{t("You do not have permission to edit this contest.")}</p>
          <div className="button-row">
            <Link href={`/contests/${contest.id}`} className="button button-secondary">
              {t("Back to Contest")}</Link>
          </div>
        </section>
      )}
    </div>
  );
}
