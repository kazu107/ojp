"use client";
import { useI18n } from "@/components/i18n-provider";


import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import { MarkdownBlock } from "@/components/markdown-block";
import { ProblemSamplesSection } from "@/components/problem-samples-section";
import { learningRequest } from "@/lib/learning-client";
import { SOURCE_CODE_TEMPLATES } from "@/lib/source-code-templates";
import { submissionStatusLabel } from "@/lib/presentation";
import type { Language, ProblemSampleCase, Submission } from "@/lib/types";

const CodeEditor = dynamic(
  () => import("./code-editor").then((module) => module.CodeEditor),
  { ssr: false },
);
export interface LearningProblem {
  id: string;
  title: string;
  statementMarkdown: string;
  inputDescription: string;
  outputDescription: string;
  constraintsMarkdown: string;
  sampleCases: ProblemSampleCase[];
  samplePairCount: number;
}

export function LearningPractice({
  problem,
  storagePrefix,
  signedIn,
  allowPastAccepted,
  complete,
}: {
  problem: LearningProblem;
  storagePrefix: string;
  signedIn: boolean;
  allowPastAccepted: boolean;
  complete: (submissionId: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [language, setLanguage] = useState<Language>("python");
  const [drafts, setDrafts] = useState(SOURCE_CODE_TEMPLATES);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pastId, setPastId] = useState("");
  const key = `${storagePrefix}:practice`;
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
      const next = { ...SOURCE_CODE_TEMPLATES };
      for (const value of ["cpp", "python", "java", "javascript"] as Language[])
        if (
          typeof saved.drafts?.[value] === "string" &&
          saved.drafts[value].length <= 262144
        )
          next[value] = saved.drafts[value];
      setDrafts(next);
      if (["cpp", "python", "java", "javascript"].includes(saved.language))
        setLanguage(saved.language);
      if (typeof saved.submissionId === "string")
        void learningRequest<{ submission: Submission }>(
          `/api/submissions/${encodeURIComponent(saved.submissionId)}`,
        )
          .then((result) => setSubmission(result.submission))
          .catch(() => {});
    } catch {
      /* Optional browser persistence. */
    }
  }, [key]);
  function persist(
    nextDrafts: typeof drafts,
    nextLanguage: Language,
    submissionId?: string,
  ) {
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          drafts: nextDrafts,
          language: nextLanguage,
          submissionId: submissionId ?? submission?.id,
        }),
      );
    } catch {
      /* Optional browser persistence. */
    }
  }
  const submissionId = submission?.id;
  const status = submission?.status;
  useEffect(() => {
    if (
      !submissionId ||
      !status ||
      status === "accepted" ||
      !["pending", "queued", "compiling", "running", "judging"].includes(status)
    )
      return;
    let cancelled = false;
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const result = await learningRequest<{ submission: Submission }>(
          `/api/submissions/${encodeURIComponent(submissionId)}`,
          { signal: abort.signal },
        );
        if (cancelled) return;
        setSubmission(result.submission);
      } catch (error) {
        if (!cancelled)
          setError(
            error instanceof Error
              ? error.message
              : "結果の取得に失敗しました。",
          );
      }
    }, 2500);
    return () => {
      cancelled = true;
      abort.abort();
      clearTimeout(timer);
    };
  }, [submissionId, status, submission]);

  return (
    <div className="stack">
      <div className="button-row">
        <h3 className="panel-title">{problem.title}</h3>
        <Link className="link" href={`/problems/${problem.id}`} target="_blank">
          {t("問題ページを開く")}</Link>
      </div>
      <MarkdownBlock text={problem.statementMarkdown} />
      <div className="grid-2">
        <section>
          <h4>{t("入力")}</h4>
          <MarkdownBlock text={problem.inputDescription} />
        </section>
        <section>
          <h4>{t("出力")}</h4>
          <MarkdownBlock text={problem.outputDescription} />
        </section>
      </div>
      <MarkdownBlock text={problem.constraintsMarkdown} />
      <ProblemSamplesSection
        initialSamples={problem.sampleCases}
        samplePairCount={problem.samplePairCount}
        loadUrl={`/api/problems/${problem.id}/samples`}
      />
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            const result = await learningRequest<{ submission: Submission }>(
              "/api/submissions",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  problemId: problem.id,
                  language,
                  sourceCode: drafts[language],
                }),
              },
            );
            setSubmission(result.submission);
            persist(drafts, language, result.submission.id);
          } catch (error) {
            setError(
              error instanceof Error ? error.message : "提出に失敗しました。",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          <span className="field-label">{t("提出言語")}</span>
          <select
            className="select"
            value={language}
            onChange={(event) => {
              const value = event.target.value as Language;
              setLanguage(value);
              persist(drafts, value);
            }}
          >
            {(["cpp", "python", "java", "javascript"] as Language[]).map(
              (value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ),
            )}
          </select>
        </label>
        <CodeEditor
          language={language}
          value={drafts[language]}
          onChange={(source) => {
            const next = { ...drafts, [language]: source };
            setDrafts(next);
            persist(next, language);
          }}
          minHeight={280}
        />
        <button type="submit" className="button" disabled={!signedIn || busy}>
          {busy ? t("提出中…") : t("提出する")}
        </button>
      </form>
      {submission ? (
        <div className="learning-submission">
          <span className="badge">
            {t(submissionStatusLabel(submission.status))}
          </span>
          <Link
            className="link"
            href={`/submissions/${submission.id}`}
            target="_blank"
          >
            {t("Test Results・提出詳細")}</Link>
          {submission.status === "accepted" ? (
            <button
              className="button button-secondary"
              disabled={busy}
              type="button"
              onClick={async () => {
                setBusy(true);
                try {
                  await complete(submission.id);
                } catch (error) {
                  setError(
                    error instanceof Error
                      ? error.message
                      : "進捗保存に失敗しました。",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t("ACを確認して完了にする")}</button>
          ) : null}
        </div>
      ) : null}
      {allowPastAccepted && signedIn ? (
        <details>
          <summary>{t("過去のAC提出を使って完了にする")}</summary>
          <form
            className="form"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError("");
              try {
                await complete(pastId);
              } catch (error) {
                setError(
                  error instanceof Error
                    ? error.message
                    : "AC提出を確認できませんでした。",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="field">
              <span className="field-label">{t("提出詳細URLの最後にある提出ID")}</span>
              <input
                className="input"
                value={pastId}
                onChange={(event) => setPastId(event.target.value)}
              />
            </label>
            <button
              className="button button-secondary"
              disabled={!pastId || busy}
            >
              {t("提出を確認")}</button>
          </form>
        </details>
      ) : null}
      {error ? <p role="alert">{t(error)}</p> : null}
      {!signedIn ? (
        <p className="text-soft">{t("提出と進捗保存にはログインしてください。")}</p>
      ) : null}
    </div>
  );
}
