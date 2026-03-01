"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ExplanationVisibility,
  Language,
  Problem,
  TestCaseVisibility,
  Visibility,
} from "@/lib/types";

const LANGUAGE_OPTIONS: Array<{ value: Language; label: string }> = [
  { value: "cpp", label: "C++" },
  { value: "python", label: "Python" },
  { value: "java", label: "Java" },
  { value: "javascript", label: "JavaScript" },
];

type ProblemEditorFormProps =
  | {
      mode: "create";
      initialProblem?: undefined;
    }
  | {
      mode: "edit";
      initialProblem: Problem;
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
  timeLimitMs: number;
  memoryLimitMb: number;
  supportedLanguages: Language[];
  testCaseVisibility: TestCaseVisibility;
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
    timeLimitMs: 2000,
    memoryLimitMb: 512,
    supportedLanguages: ["cpp", "python", "java", "javascript"],
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
    timeLimitMs: problem.timeLimitMs,
    memoryLimitMb: problem.memoryLimitMb,
    supportedLanguages: problem.supportedLanguages,
    testCaseVisibility: problem.testCaseVisibility,
  };
}

export function ProblemEditorForm(props: ProblemEditorFormProps) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(
    props.mode === "edit" ? stateFromProblem(props.initialProblem) : emptyState(),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string>("");

  const endpoint = useMemo(() => {
    if (props.mode === "edit") {
      return `/api/problems/${props.initialProblem.id}`;
    }
    return "/api/problems";
  }, [props]);

  const method = props.mode === "edit" ? "PATCH" : "POST";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.supportedLanguages.length === 0) {
      setError("少なくとも1つの言語を選択してください。");
      return;
    }

    setIsSaving(true);
    setError("");

    try {
      const response = await fetch(endpoint, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "保存に失敗しました。");
      }

      const body = (await response.json()) as { problem: Problem };
      router.push(`/problems/${body.problem.id}`);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "予期しないエラーが発生しました。");
    } finally {
      setIsSaving(false);
    }
  }

  function toggleLanguage(language: Language) {
    setForm((prev) => {
      const exists = prev.supportedLanguages.includes(language);
      return {
        ...prev,
        supportedLanguages: exists
          ? prev.supportedLanguages.filter((item) => item !== language)
          : [...prev.supportedLanguages, language],
      };
    });
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <div className="form-grid">
        <label className="field">
          <span className="field-label">タイトル</span>
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

      <label className="field">
        <span className="field-label">Statement (Markdown)</span>
        <textarea
          className="textarea"
          required
          value={form.statementMarkdown}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, statementMarkdown: event.target.value }))
          }
        />
      </label>

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
            「ケース名を公開すると hidden test の意図や構成が推測されやすくなります。通常はケース番号のみ公開を推奨します。」
          </p>
        </label>
      </div>

      <fieldset className="field">
        <legend className="field-label">対応言語</legend>
        <div className="button-row">
          {LANGUAGE_OPTIONS.map((option) => {
            const selected = form.supportedLanguages.includes(option.value);
            return (
              <button
                type="button"
                key={option.value}
                className="button"
                style={{
                  background: selected ? "linear-gradient(120deg, var(--accent), var(--accent-soft))" : undefined,
                  color: selected ? "#0f1218" : undefined,
                }}
                onClick={() => toggleLanguage(option.value)}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      {error ? <p className="badge badge-red">{error}</p> : null}

      <div className="button-row">
        <button className="button" type="submit" disabled={isSaving}>
          {isSaving ? "保存中..." : props.mode === "edit" ? "更新する" : "作成する"}
        </button>
      </div>
    </form>
  );
}
