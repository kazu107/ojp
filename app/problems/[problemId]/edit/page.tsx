import Link from "next/link";
import { notFound } from "next/navigation";
import { ProblemEditorForm } from "@/components/problem-editor-form";
import { ProblemPackageUploadForm } from "@/components/problem-package-upload-form";
import {
  canEditProblemByViewer,
  getCurrentUser,
  getProblemForViewer,
} from "@/lib/store";

interface EditProblemPageProps {
  params: Promise<{
    problemId: string;
  }>;
}

export default async function EditProblemPage({ params }: EditProblemPageProps) {
  const { problemId } = await params;
  const me = await getCurrentUser();
  const problem = getProblemForViewer(problemId, me.id);
  if (!problem) {
    notFound();
  }

  const canEdit = canEditProblemByViewer(problem, me.id);

  return (
    <div className="page">
      <section className="page-head">
        <div>
          <h1 className="page-title">Edit Problem</h1>
          <p className="page-subtitle">
            Update statement, limits, language settings, and package validation for this problem.
          </p>
        </div>
      </section>

      {canEdit ? (
        <>
          <section className="panel">
            <ProblemEditorForm mode="edit" initialProblem={problem} />
          </section>
          <section className="panel stack">
            <h2 className="panel-title">Problem Package</h2>
            <p className="panel-subtitle">
              Upload a ZIP package to validate required files and apply judge settings from
              `config.json`.
            </p>
            <ProblemPackageUploadForm problemId={problem.id} />
          </section>
        </>
      ) : (
        <section className="panel stack">
          <p className="badge badge-red">You do not have permission to edit this problem.</p>
          <div className="button-row">
            <Link href={`/problems/${problem.id}`} className="button button-secondary">
              Back to Problem
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
