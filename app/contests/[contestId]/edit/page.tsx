import { notFound } from "next/navigation";
import { ContestEditorForm } from "@/components/contest-editor-form";
import { getContestForViewer, getCurrentUser, listProblemsForListView } from "@/lib/store";

interface EditContestPageProps {
  params: Promise<{
    contestId: string;
  }>;
}

export default async function EditContestPage({ params }: EditContestPageProps) {
  const { contestId } = await params;
  const me = getCurrentUser();
  const contest = getContestForViewer(contestId, me.id);
  if (!contest) {
    notFound();
  }
  const availableProblems = listProblemsForListView(me.id);

  return (
    <div className="page">
      <section className="page-head">
        <div>
          <h1 className="page-title">Edit Contest</h1>
          <p className="page-subtitle">
            {contest.title} の開催情報と問題セットを更新します。
          </p>
        </div>
      </section>
      <section className="panel">
        <ContestEditorForm
          mode="edit"
          initialContest={contest}
          availableProblems={availableProblems}
        />
      </section>
    </div>
  );
}
