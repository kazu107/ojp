import { notFound } from "next/navigation";
import { ProblemEditorForm } from "@/components/problem-editor-form";
import { getCurrentUser, getProblemForViewer } from "@/lib/store";

interface EditProblemPageProps {
  params: Promise<{
    problemId: string;
  }>;
}

export default async function EditProblemPage({ params }: EditProblemPageProps) {
  const { problemId } = await params;
  const me = getCurrentUser();
  const problem = getProblemForViewer(problemId, me.id);
  if (!problem) {
    notFound();
  }

  return (
    <div className="page">
      <section className="page-head">
        <div>
          <h1 className="page-title">Edit Problem</h1>
          <p className="page-subtitle">
            {problem.title} の設定を更新します。公開範囲とジャッジ制限値はそのままAPIへ反映されます。
          </p>
        </div>
      </section>
      <section className="panel">
        <ProblemEditorForm mode="edit" initialProblem={problem} />
      </section>
    </div>
  );
}
