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
            Create a new problem, import a ZIP to auto-fill fields, or build test groups and cases
            manually on the page.
          </p>
          <p className="text-soft">
            ZIP import and manual test case editing are both handled from the main form below.
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
