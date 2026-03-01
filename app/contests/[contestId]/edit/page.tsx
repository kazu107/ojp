import Link from "next/link";
import { notFound } from "next/navigation";
import { ContestEditorForm } from "@/components/contest-editor-form";
import {
  canEditContestByViewer,
  getContestForViewer,
  getCurrentUser,
  listProblemsForListView,
} from "@/lib/store";

interface EditContestPageProps {
  params: Promise<{
    contestId: string;
  }>;
}

export default async function EditContestPage({ params }: EditContestPageProps) {
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
          <h1 className="page-title">Edit Contest</h1>
          <p className="page-subtitle">Update contest window, settings, and problem set.</p>
        </div>
      </section>

      {canEdit ? (
        <section className="panel">
          <ContestEditorForm
            mode="edit"
            initialContest={contest}
            availableProblems={availableProblems}
          />
        </section>
      ) : (
        <section className="panel stack">
          <p className="badge badge-red">You do not have permission to edit this contest.</p>
          <div className="button-row">
            <Link href={`/contests/${contest.id}`} className="button button-secondary">
              Back to Contest
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
