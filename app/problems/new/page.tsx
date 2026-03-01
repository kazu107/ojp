import { ProblemEditorForm } from "@/components/problem-editor-form";
import { canCreateProblemByRole, getCurrentUser } from "@/lib/store";

export default async function NewProblemPage() {
  const me = await getCurrentUser();
  const canCreateProblem = canCreateProblemByRole(me.role);

  return (
    <div className="page">
      <section className="page-head">
        <div>
          <h1 className="page-title">Create Problem</h1>
          <p className="page-subtitle">
            問題本文、公開範囲、制限時間、対応言語を登録します。仕様書の問題作成画面要件に合わせたフォームです。
          </p>
        </div>
      </section>
      <section className="panel">
        {canCreateProblem ? (
          <ProblemEditorForm mode="create" />
        ) : (
          <p className="badge badge-red">
            You need `problem_author` (or admin) role to create problems.
          </p>
        )}
      </section>
    </div>
  );
}
