import { ProblemEditorForm } from "@/components/problem-editor-form";

export default function NewProblemPage() {
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
        <ProblemEditorForm mode="create" />
      </section>
    </div>
  );
}
