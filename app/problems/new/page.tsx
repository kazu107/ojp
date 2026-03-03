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
            Create a new problem, set limits and supported languages, and optionally attach a ZIP
            package for test cases.
          </p>
          <p className="text-soft">
            If ZIP is selected, it will be validated and registered automatically after the problem
            is created.
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
