"use client";

import { DraftRecovery, useDraftRecovery } from "./draft-recovery";
import { SUBMISSION_LANGUAGES } from "@/lib/languages";
import { useI18n } from "@/components/i18n-provider";


import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CodeEditor } from "@/components/code-editor";
import { SOURCE_CODE_TEMPLATES } from "@/lib/source-code-templates";
import { Language } from "@/lib/types";

interface SubmissionFormProps {
  problemId: string;
  contestId?: string | null;
  virtualParticipationId?: string | null;
  interactive?: boolean;
}


const DEFAULT_SUBMISSION_LANGUAGE: Language = "python";

export function SubmissionForm({
  problemId,
  contestId = null,
  virtualParticipationId = null,
  interactive = false,
}: SubmissionFormProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [language, setLanguage] = useState<Language>(DEFAULT_SUBMISSION_LANGUAGE);
  const [draftsByLanguage, setDraftsByLanguage] = useState<Record<Language, string>>(
    SOURCE_CODE_TEMPLATES,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const sourceCode = draftsByLanguage[language];

  const draftValue = useMemo(() => ({language,draftsByLanguage}), [language,draftsByLanguage]);
  const recovery = useDraftRecovery({name: `submission:${problemId}:${contestId ?? "practice"}:${virtualParticipationId ?? "official"}`,base:"1",value:draftValue,enabled:!isSubmitting,restore(saved){
    if (!saved || !SUBMISSION_LANGUAGES.includes(saved.language) || !saved.draftsByLanguage) throw new Error("Invalid local draft.");
    const next={...SOURCE_CODE_TEMPLATES};
    for(const key of SUBMISSION_LANGUAGES)if(typeof saved.draftsByLanguage[key]==="string")next[key]=saved.draftsByLanguage[key];
    setLanguage(saved.language);setDraftsByLanguage(next);
  }});

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
          virtualParticipationId,
          language,
          sourceCode,
        }),
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "提出に失敗しました。");
      }

      const body = (await response.json()) as { submission: { id: string } };
      await recovery.clear();
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
      <DraftRecovery draft={recovery} />
      {interactive ? <p className="badge badge-blue">{t("This is an interactive problem. Flush every query and read responses incrementally; do not wait for EOF.")}</p> : null}
      <label className="field">
        <span className="field-label">{t("Language")}</span>
        <select
          className="select"
          value={language}
          onChange={(event) => setLanguage(event.target.value as Language)}
        >
          {SUBMISSION_LANGUAGES.map((item) => (
            <option key={item} value={item}>
              {t(item)}
            </option>
          ))}
        </select>
      </label>

      <div className="field">
        <span className="field-label">{t("Source Code")}</span>
        <CodeEditor
          language={language}
          minHeight={320}
          value={sourceCode}
          onChange={(value) =>
            setDraftsByLanguage((current) => ({
              ...current,
              [language]: value,
            }))
          }
        />
      </div>

      <p className="text-soft">
        {t("提出は非同期ジャッジされます。対象問題に ZIP パッケージ（tests/config）が未設定の場合は `internal_error` になります。")}</p>
      {contestId ? (
        <p className="text-soft">
          {t("Contest submission mode: contestId=")}{contestId}
        </p>
      ) : null}

      {error ? <p className="badge badge-red">{t(error)}</p> : null}
      {virtualParticipationId ? <p className="text-soft">{t("Virtual submissions do not affect official standings or ratings.")}</p> : null}

      <div className="button-row">
        <button className="button" type="submit" disabled={isSubmitting}>
          {isSubmitting ? t("提出中...") : t("提出する")}
        </button>
      </div>
    </form>
  );
}
