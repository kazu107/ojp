import { ContestEditorForm } from "@/components/contest-editor-form";
import { getCurrentUser, listProblemsForListView } from "@/lib/store";

export default async function NewContestPage() {
  const me = await getCurrentUser();
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
        <ContestEditorForm mode="create" availableProblems={availableProblems} />
      </section>
    </div>
  );
}
