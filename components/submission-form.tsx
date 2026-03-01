"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Language } from "@/lib/types";

interface SubmissionFormProps {
  problemId: string;
  allowedLanguages: Language[];
  contestId?: string | null;
}

export function SubmissionForm({
  problemId,
  allowedLanguages,
  contestId = null,
}: SubmissionFormProps) {
  const router = useRouter();
  const [language, setLanguage] = useState<Language>(allowedLanguages[0] ?? "python");
  const [sourceCode, setSourceCode] = useState<string>(
    "def solve():\n    n = int(input())\n    print(n)\n\nsolve()",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/submissions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          problemId,
          contestId,
          language,
          sourceCode,
        }),
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "提出に失敗しました。");
      }

      const body = (await response.json()) as { submission: { id: string } };
      router.push(`/submissions/${body.submission.id}`);
      router.refresh();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "予期しないエラーが発生しました。");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <label className="field">
        <span className="field-label">Language</span>
        <select
          className="select"
          value={language}
          onChange={(event) => setLanguage(event.target.value as Language)}
        >
          {allowedLanguages.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="field-label">Source Code</span>
        <textarea
          className="textarea"
          style={{ minHeight: 300, fontFamily: "var(--font-jp-mono)" }}
          required
          value={sourceCode}
          onChange={(event) => setSourceCode(event.target.value)}
        />
      </label>

      <p className="text-soft">
        疑似ジャッジでは `wrong_answer`, `time_limit`, `runtime_error` などの文字列を含めると対応する判定を再現できます。
      </p>
      {contestId ? (
        <p className="text-soft">
          Contest submission mode: contestId={contestId}
        </p>
      ) : null}

      {error ? <p className="badge badge-red">{error}</p> : null}

      <div className="button-row">
        <button className="button" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "提出中..." : "提出する"}
        </button>
      </div>
    </form>
  );
}
