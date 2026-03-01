import { ContestEditorForm } from "@/components/contest-editor-form";
import {
  canCreateContestByRole,
  getCurrentUser,
  listProblemsForListView,
} from "@/lib/store";

export default async function NewContestPage() {
  const me = await getCurrentUser();
  const canCreateContest = canCreateContestByRole(me.role);
  const availableProblems = listProblemsForListView(me.id);

  return (
    <div className="page">
      <section className="page-head">
        <div>
          <h1 className="page-title">Create Contest</h1>
          <p className="page-subtitle">
            開催期間、問題セット、順位表公開設定を入力してコンテストを作成します。
          </p>
        </div>
      </section>
      <section className="panel">
        {canCreateContest ? (
          <ContestEditorForm mode="create" availableProblems={availableProblems} />
        ) : (
          <p className="badge badge-red">
            You need `contest_organizer` (or admin) role to create contests.
          </p>
        )}
      </section>
    </div>
  );
}
