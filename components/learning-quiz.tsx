"use client";
import { useI18n } from "@/components/i18n-provider";


import { useEffect, useState } from "react";
import { MarkdownBlock } from "@/components/markdown-block";
import type { LearningPublicItem } from "@/lib/learning";
import type { gradeLearningQuiz } from "@/lib/learning";

type Grade = ReturnType<typeof gradeLearningQuiz>;
export function LearningQuiz({
  item,
  storagePrefix,
  signedIn,
  submit,
}: {
  item: LearningPublicItem;
  storagePrefix: string;
  signedIn: boolean;
  submit: (answers: Record<string, string>) => Promise<Grade>;
}) {
  const { t } = useI18n();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Grade | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const key = `${storagePrefix}:quiz`;
  useEffect(() => {
    let disposed = false;
    queueMicrotask(() => {
    if (disposed) return;
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
      const next: Record<string, string> = {};
      for (const question of item.questions)
        if (question.options.some((option) => option.id === saved[question.id]))
          next[question.id] = saved[question.id];
      setAnswers(next);
    } catch {
      /* Ignore unavailable browser storage. */
    }
    });
    return () => { disposed = true; };
  }, [key, item.questions]);
  function select(question: string, answer: string) {
    const next = { ...answers, [question]: answer };
    setAnswers(next);
    setResult(null);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* Optional persistence. */
    }
  }
  return (
    <form
      className="stack"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        try {
          setResult(await submit(answers));
        } catch (error) {
          setError(
            error instanceof Error ? error.message : "採点に失敗しました。",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="text-soft">
        {t("Passing score: {percent}%. Answers are graded on the server.", { percent: item.passingPercent })}</p>
      {item.questions.map((question, index) => (
        <fieldset key={question.id} className="learning-question">
          <legend>{t("問 ")}{index + 1}</legend>
          <MarkdownBlock text={question.prompt} />
          {question.options.map((option) => (
            <label className="learning-option" key={option.id}>
              <input
                type="radio"
                name={question.id}
                value={option.id}
                checked={answers[question.id] === option.id}
                onChange={() => select(question.id, option.id)}
              />
              <span>{option.text}</span>
            </label>
          ))}
          {result ? (
            <div className="learning-quiz-feedback">
              <span
                className={`badge ${result.results[index].correct ? "badge-green" : "badge-red"}`}
              >
                {result.results[index].correct ? t("正解") : t("不正解")}
              </span>
              <p>
                {t("正解：")}{
                  question.options.find(
                    (option) => option.id === result.results[index].answerId,
                  )?.text
                }
              </p>
              <MarkdownBlock text={result.results[index].explanation} />
            </div>
          ) : null}
        </fieldset>
      ))}
      {result ? (
        <p className={`badge ${result.passed ? "badge-green" : "badge-red"}`}>
          {result.score}%：{result.passed ? t("合格") : t("もう一度確認しましょう")}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-soft">
          {t(error)}
        </p>
      ) : null}
      <button
        className="button"
        type="submit"
        disabled={
          !signedIn ||
          busy ||
          item.questions.some((question) => !answers[question.id])
        }
      >
        {busy ? t("採点中…") : t("回答して採点する")}
      </button>
      {!signedIn ? (
        <p className="text-soft">{t("採点と進捗保存にはログインしてください。")}</p>
      ) : null}
    </form>
  );
}
