"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CodeEditor } from "@/components/code-editor";
import { MarkdownBlock } from "@/components/markdown-block";
import { ProblemPackageDraftEditor } from "@/components/problem-package-draft-editor";
import { CHECKER_SOURCE_TEMPLATES } from "@/lib/checker-source-templates";
import { StatusBadge } from "@/components/status-badge";
import { badgeClassForSubmission, submissionStatusLabel } from "@/lib/presentation";
import { SOURCE_CODE_TEMPLATES } from "@/lib/source-code-templates";
import {
  ExplanationVisibility,
  Language,
  Problem,
  Submission,
  SubmissionStatus,
  TestCaseVisibility,
  Visibility,
} from "@/lib/types";
import {
  ProblemPackageEditorDraft,
  ProblemPackageInspectResult,
} from "@/lib/problem-package-types";

type ProblemEditorFormProps =
  | {
      mode: "create";
      initialProblem?: undefined;
      initialPackageDraft?: ProblemPackageEditorDraft | null;
    }
  | {
      mode: "edit";
      initialProblem: Problem;
      initialPackageDraft?: ProblemPackageEditorDraft | null;
    };

interface FormState {
  title: string;
  slug: string;
  statementMarkdown: string;
  inputDescription: string;
  outputDescription: string;
  constraintsMarkdown: string;
  explanationMarkdown: string;
  explanationVisibility: ExplanationVisibility;
  visibility: Visibility;
  difficulty: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  testCaseVisibility: TestCaseVisibility;
}

interface PackageTestPreviewResult {
  status: SubmissionStatus;
  score: number;
  totalTimeMs: number;
  peakMemoryKb: number;
  testResults: Submission["testResults"];
}

function emptyState(): FormState {
  return {
    title: "",
    slug: "",
    statementMarkdown: "",
    inputDescription: "",
    outputDescription: "",
    constraintsMarkdown: "",
    explanationMarkdown: "",
    explanationVisibility: "private",
    visibility: "public",
    difficulty: "",
    timeLimitMs: 2000,
    memoryLimitMb: 512,
    testCaseVisibility: "case_index_only",
  };
}

function stateFromProblem(problem: Problem): FormState {
  return {
    title: problem.title,
    slug: problem.slug,
    statementMarkdown: problem.statementMarkdown,
    inputDescription: problem.inputDescription,
    outputDescription: problem.outputDescription,
    constraintsMarkdown: problem.constraintsMarkdown,
    explanationMarkdown: problem.explanationMarkdown,
    explanationVisibility: problem.explanationVisibility,
    visibility: problem.visibility,
    difficulty: problem.difficulty === null ? "" : String(problem.difficulty),
    timeLimitMs: problem.timeLimitMs,
    memoryLimitMb: problem.memoryLimitMb,
    testCaseVisibility: problem.testCaseVisibility,
  };
}

function createId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function createBlankPackageDraft(): ProblemPackageEditorDraft {
  return {
    sourceLabel: "manual-package",
    checkerType: "exact",
    checkerLanguage: "python",
    checkerSourceCode: CHECKER_SOURCE_TEMPLATES.python,
    compareMode: "exact",
    zipSizeBytes: 0,
    fileCount: 0,
    samples: [
      {
        id: createId("sample"),
        name: "sample1",
        description: "",
        input: "",
        output: "",
      },
    ],
    warnings: [],
    groups: [
      {
        id: createId("group"),
        name: "group1",
        score: null,
        tests: [
          {
            id: createId("case"),
            name: "01",
            input: "",
            output: "",
          },
        ],
      },
    ],
  };
}

function parseDifficultyInput(
  raw: string,
): { ok: true; value: number | null } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: true, value: null };
  }
  if (!/^-?\d+$/.test(trimmed)) {
    return { ok: false, message: "Difficulty must be an integer." };
  }
  return { ok: true, value: Number.parseInt(trimmed, 10) };
}

export function ProblemEditorForm(props: ProblemEditorFormProps) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(
    props.mode === "edit" ? stateFromProblem(props.initialProblem) : emptyState(),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isInspectingPackage, setIsInspectingPackage] = useState(false);
  const [error, setError] = useState<string>("");
  const [packageError, setPackageError] = useState<string>("");
  const [packageNotice, setPackageNotice] = useState<string>("");
  const [packageDraft, setPackageDraft] = useState<ProblemPackageEditorDraft | null>(
    props.initialPackageDraft ?? null,
  );
  const [previewLanguage, setPreviewLanguage] = useState<Language>("python");
  const [previewDraftsByLanguage, setPreviewDraftsByLanguage] = useState<Record<Language, string>>(
    SOURCE_CODE_TEMPLATES,
  );
  const [isRunningPreview, setIsRunningPreview] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [previewResult, setPreviewResult] = useState<PackageTestPreviewResult | null>(null);
  const [createdProblemId, setCreatedProblemId] = useState<string | null>(null);

  const endpoint = useMemo(() => {
    if (props.mode === "edit") {
      return `/api/problems/${props.initialProblem.id}`;
    }
    return "/api/problems";
  }, [props]);

  const method = props.mode === "edit" ? "PATCH" : "POST";

  async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
    try {
      const body = (await response.json()) as { error?: string };
      if (typeof body.error === "string" && body.error.trim().length > 0) {
        return body.error;
      }
    } catch {
      // no-op
    }
    return fallback;
  }

  async function inspectPackage(file: File) {
    setIsInspectingPackage(true);
    setPackageError("");
    setPackageNotice("");

    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch("/api/problem-packages/inspect", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const message = await parseErrorMessage(response, "failed to inspect ZIP package");
        throw new Error(message);
      }

      const inspected = (await response.json()) as ProblemPackageInspectResult;
      setForm((prev) => ({
        ...prev,
        title: inspected.prefill.title || prev.title,
        slug: inspected.prefill.slugSuggestion || prev.slug,
        statementMarkdown: inspected.prefill.statementMarkdown,
        inputDescription: inspected.prefill.inputDescription,
        outputDescription: inspected.prefill.outputDescription,
        constraintsMarkdown: inspected.prefill.constraintsMarkdown,
        explanationMarkdown: inspected.prefill.explanationMarkdown,
        timeLimitMs: inspected.prefill.timeLimitMs,
        memoryLimitMb: inspected.prefill.memoryLimitMb,
      }));
      setPackageDraft(inspected.draft);
      setPackageNotice(`Imported ${inspected.package.fileName} and filled the form fields.`);
    } catch (inspectError) {
      setPackageError(
        inspectError instanceof Error ? inspectError.message : "failed to inspect ZIP package",
      );
    } finally {
      setIsInspectingPackage(false);
    }
  }

  async function saveProblemPackage(problemId: string) {
    if (!packageDraft) {
      return;
    }

    const response = await fetch(`/api/problems/${problemId}/package/manual`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sourceLabel: packageDraft.sourceLabel,
        checkerType: packageDraft.checkerType,
        checkerLanguage: packageDraft.checkerLanguage,
        checkerSourceCode: packageDraft.checkerSourceCode,
        compareMode: packageDraft.compareMode,
        zipSizeBytes: packageDraft.zipSizeBytes,
        fileCount: packageDraft.fileCount,
        samples: packageDraft.samples.map((sample) => ({
          name: sample.name,
          description: sample.description,
          input: sample.input,
          output: sample.output,
        })),
        warnings: packageDraft.warnings,
        timeLimitMs: form.timeLimitMs,
        memoryLimitMb: form.memoryLimitMb,
        groups: packageDraft.groups.map((group) => ({
          name: group.name,
          score: group.score,
          tests: group.tests.map((testCase) => ({
            name: testCase.name,
            input: testCase.input,
            output: testCase.output,
          })),
        })),
      }),
    });

    if (!response.ok) {
      const packageMessage = await parseErrorMessage(
        response,
        "failed to save problem package",
      );
      throw new Error(packageMessage);
    }
  }

  async function runPackagePreview() {
    if (!packageDraft) {
      setPreviewError("Judge package is required before running a local test.");
      return;
    }

    const sourceCode = previewDraftsByLanguage[previewLanguage] ?? "";
    if (!sourceCode.trim()) {
      setPreviewError("Source code is required.");
      return;
    }

    setIsRunningPreview(true);
    setPreviewError("");
    setPreviewResult(null);

    try {
      const response = await fetch("/api/problem-packages/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          language: previewLanguage,
          sourceCode,
          timeLimitMs: form.timeLimitMs,
          memoryLimitMb: form.memoryLimitMb,
          draft: {
            sourceLabel: packageDraft.sourceLabel,
            checkerType: packageDraft.checkerType,
            checkerLanguage: packageDraft.checkerLanguage,
            checkerSourceCode: packageDraft.checkerSourceCode,
            compareMode: packageDraft.compareMode,
            zipSizeBytes: packageDraft.zipSizeBytes,
            fileCount: packageDraft.fileCount,
            samples: packageDraft.samples.map((sample) => ({
              name: sample.name,
              description: sample.description,
              input: sample.input,
              output: sample.output,
            })),
            warnings: packageDraft.warnings,
            groups: packageDraft.groups.map((group) => ({
              name: group.name,
              score: group.score,
              tests: group.tests.map((testCase) => ({
                name: testCase.name,
                input: testCase.input,
                output: testCase.output,
              })),
            })),
          },
        }),
      });
      if (!response.ok) {
        const message = await parseErrorMessage(response, "failed to run package test");
        throw new Error(message);
      }

      const body = (await response.json()) as { result: PackageTestPreviewResult };
      setPreviewResult(body.result);
    } catch (previewRunError) {
      setPreviewError(
        previewRunError instanceof Error
          ? previewRunError.message
          : "failed to run package test",
      );
    } finally {
      setIsRunningPreview(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.statementMarkdown.trim()) {
      setError("Statement is required.");
      return;
    }
    const parsedDifficulty = parseDifficultyInput(form.difficulty);
    if (!parsedDifficulty.ok) {
      setError(parsedDifficulty.message);
      return;
    }

    setIsSaving(true);
    setError("");
    setCreatedProblemId(null);

    try {
      const response = await fetch(endpoint, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...form,
          difficulty: parsedDifficulty.value,
        }),
      });

      if (!response.ok) {
        const message = await parseErrorMessage(response, "failed to save problem");
        throw new Error(message);
      }

      const body = (await response.json()) as { problem: Problem };
      if (props.mode === "create") {
        setCreatedProblemId(body.problem.id);
      }
      await saveProblemPackage(body.problem.id);

      router.push(`/problems/${body.problem.id}`);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unexpected error occurred.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <div className="form-grid">
        <label className="field">
          <span className="field-label">Title</span>
          <input
            className="input"
            required
            value={form.title}
            onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
            placeholder="A - Sample Problem"
          />
        </label>
        <label className="field">
          <span className="field-label">Slug</span>
          <input
            className="input"
            required
            value={form.slug}
            onChange={(event) => setForm((prev) => ({ ...prev, slug: event.target.value }))}
            placeholder="a-sample-problem"
          />
        </label>
      </div>

      <div className="field">
        <span className="field-label">Statement (Markdown)</span>
        <CodeEditor
          language="markdown"
          minHeight={260}
          value={form.statementMarkdown}
          onChange={(value) => setForm((prev) => ({ ...prev, statementMarkdown: value }))}
        />
        <div className="markdown-preview">
          <span className="field-label">Live Preview</span>
          <div className="panel stack">
            <MarkdownBlock text={form.statementMarkdown || "_No preview yet._"} />
          </div>
        </div>
      </div>

      <div className="form-grid">
        <label className="field">
          <span className="field-label">Input Description</span>
          <textarea
            className="textarea"
            required
            value={form.inputDescription}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, inputDescription: event.target.value }))
            }
          />
        </label>
        <label className="field">
          <span className="field-label">Output Description</span>
          <textarea
            className="textarea"
            required
            value={form.outputDescription}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, outputDescription: event.target.value }))
            }
          />
        </label>
      </div>

      <div className="form-grid">
        <label className="field">
          <span className="field-label">Constraints</span>
          <textarea
            className="textarea"
            required
            value={form.constraintsMarkdown}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, constraintsMarkdown: event.target.value }))
            }
          />
        </label>
        <label className="field">
          <span className="field-label">Explanation</span>
          <textarea
            className="textarea"
            value={form.explanationMarkdown}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, explanationMarkdown: event.target.value }))
            }
          />
        </label>
      </div>

      <div className="form-grid">
        <label className="field">
          <span className="field-label">Visibility</span>
          <select
            className="select"
            value={form.visibility}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, visibility: event.target.value as Visibility }))
            }
          >
            <option value="public">Public</option>
            <option value="unlisted">Unlisted</option>
            <option value="private">Private</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">Explanation Visibility</span>
          <select
            className="select"
            value={form.explanationVisibility}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                explanationVisibility: event.target.value as ExplanationVisibility,
              }))
            }
          >
            <option value="always">always</option>
            <option value="contest_end">contest_end</option>
            <option value="private">private (default)</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">Difficulty (AtCoder rating)</span>
          <input
            className="input"
            type="number"
            step={1}
            value={form.difficulty}
            onChange={(event) => setForm((prev) => ({ ...prev, difficulty: event.target.value }))}
            placeholder="800"
          />
          <p className="text-soft">Optional integer value (for example: 400, 800, 1200).</p>
        </label>
        <label className="field">
          <span className="field-label">Time Limit (ms)</span>
          <input
            className="input"
            type="number"
            min={1}
            value={form.timeLimitMs}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, timeLimitMs: Number(event.target.value) }))
            }
          />
        </label>
        <label className="field">
          <span className="field-label">Memory Limit (MB)</span>
          <input
            className="input"
            type="number"
            min={1}
            value={form.memoryLimitMb}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, memoryLimitMb: Number(event.target.value) }))
            }
          />
        </label>
        <label className="field">
          <span className="field-label">Test Case Visibility</span>
          <select
            className="select"
            value={form.testCaseVisibility}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                testCaseVisibility: event.target.value as TestCaseVisibility,
              }))
            }
          >
            <option value="group_only">group_only</option>
            <option value="case_index_only">case_index_only (default)</option>
            <option value="case_name_visible">case_name_visible</option>
          </select>
          <p className="text-soft">
            Use `case_name_visible` only when needed to avoid leaking hidden test intent.
          </p>
        </label>
      </div>

      <section className="panel stack">
        <div>
          <h2 className="panel-title">Judge Package</h2>
          <p className="panel-subtitle">
            Import ZIP to auto-fill the form, or build groups and test cases manually on this page.
          </p>
        </div>

        <label className="field">
          <span className="field-label">Import ZIP</span>
          <input
            className="input"
            type="file"
            accept=".zip,application/zip"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              if (file) {
                void inspectPackage(file);
              }
            }}
          />
          <p className="text-soft">
            Selecting a ZIP inspects `statement.md` and `config.json`, fills the problem fields,
            and converts its tests into the editor below.
          </p>
        </label>

        <div className="button-row">
          {!packageDraft ? (
            <button
              type="button"
              className="button"
              onClick={() => {
                setPackageDraft(createBlankPackageDraft());
                setPackageNotice("Started a blank manual package.");
                setPackageError("");
              }}
            >
              Start Manual Package
            </button>
          ) : (
            <>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  setPackageDraft(createBlankPackageDraft());
                  setPackageNotice("Reset the package editor to a blank template.");
                  setPackageError("");
                }}
              >
                Reset to Blank
              </button>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  setPackageDraft(null);
                  setPackageNotice(
                    props.mode === "edit"
                      ? "Package editor disabled. Existing package stays unchanged on save."
                      : "Package editor cleared. This problem will be created without a package.",
                  );
                  setPackageError("");
                }}
              >
                Clear Package
              </button>
            </>
          )}
        </div>

        {isInspectingPackage ? <p className="badge badge-blue">Inspecting ZIP...</p> : null}
        {packageNotice ? <p className="badge badge-blue">{packageNotice}</p> : null}
        {packageError ? <p className="badge badge-red">{packageError}</p> : null}

        {packageDraft ? (
          <ProblemPackageDraftEditor draft={packageDraft} onChange={setPackageDraft} />
        ) : (
          <p className="empty">
            No package is attached yet. Start from a blank manual package or import a ZIP.
          </p>
        )}
      </section>

      <section className="panel stack">
        <div>
          <h2 className="panel-title">Package Test Run</h2>
          <p className="panel-subtitle">
            現在のテストケースと special judge 設定を使って、保存前にコードを試せます。
          </p>
        </div>

        <label className="field">
          <span className="field-label">Language</span>
          <select
            className="select"
            value={previewLanguage}
            onChange={(event) => setPreviewLanguage(event.target.value as Language)}
          >
            <option value="cpp">cpp</option>
            <option value="python">python</option>
            <option value="java">java</option>
            <option value="javascript">javascript</option>
          </select>
        </label>

        <div className="field">
          <span className="field-label">Source Code</span>
          <CodeEditor
            language={previewLanguage}
            minHeight={300}
            value={previewDraftsByLanguage[previewLanguage] ?? ""}
            onChange={(value) =>
              setPreviewDraftsByLanguage((current) => ({
                ...current,
                [previewLanguage]: value,
              }))
            }
          />
        </div>

        <div className="button-row">
          <button
            type="button"
            className="button"
            onClick={() => void runPackagePreview()}
            disabled={isRunningPreview || !packageDraft}
          >
            {isRunningPreview ? "Running..." : "Run Test"}
          </button>
        </div>

        {previewError ? <p className="badge badge-red">{previewError}</p> : null}

        {previewResult ? (
          <div className="stack">
            <div className="meta-inline">
              <StatusBadge className={badgeClassForSubmission(previewResult.status)}>
                {submissionStatusLabel(previewResult.status)}
              </StatusBadge>
              <span className="text-soft">Score: {previewResult.score}</span>
              <span className="text-soft">Time: {previewResult.totalTimeMs} ms</span>
              <span className="text-soft">Memory: {previewResult.peakMemoryKb} KB</span>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Group</th>
                    <th>Case</th>
                    <th>Verdict</th>
                    <th>Time</th>
                    <th>Memory</th>
                    <th>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {previewResult.testResults.map((result) => (
                    <tr key={result.id}>
                      <td>{result.groupName}</td>
                      <td>{result.testCaseName}</td>
                      <td>
                        <StatusBadge className={badgeClassForSubmission(result.verdict)}>
                          {submissionStatusLabel(result.verdict)}
                        </StatusBadge>
                      </td>
                      <td>{result.timeMs} ms</td>
                      <td>{result.memoryKb} KB</td>
                      <td>{result.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </section>

      {error ? <p className="badge badge-red">{error}</p> : null}
      {props.mode === "create" && createdProblemId ? (
        <div className="button-row">
          <Link className="button button-secondary" href={`/problems/${createdProblemId}/edit`}>
            Open Created Problem
          </Link>
        </div>
      ) : null}

      <div className="button-row">
        <button className="button" type="submit" disabled={isSaving || isInspectingPackage}>
          {isSaving ? "Saving..." : props.mode === "edit" ? "Update" : "Create"}
        </button>
      </div>
    </form>
  );
}
