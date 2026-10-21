"use client";
import { useI18n } from "@/components/i18n-provider";


import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LearningMarkdown } from "./learning-markdown";
import { LearningQuiz } from "./learning-quiz";
import { LearningPractice } from "./learning-practice";
import type { LearningProblem } from "./learning-practice";
import { learningRequest } from "@/lib/learning-client";
import type {
  gradeLearningQuiz,
  LearningOutlineChapter,
  LearningProgressView,
  LearningPublicItem,
} from "@/lib/learning";

const kindLabels = { lesson: "教材", quiz: "クイズ", problem: "練習" };
interface Props {
  courseId: string;
  versionId: string;
  chapter: LearningOutlineChapter;
  initialItemId: string;
  userId: string | null;
  initialProgress: LearningProgressView[];
}

export function LearningChapterView({
  courseId,
  versionId,
  chapter,
  initialItemId,
  userId,
  initialProgress,
}: Props) {
  const { t } = useI18n();
  const initial = chapter.items.some((item) => item.id === initialItemId)
    ? initialItemId
    : chapter.items[0].id;
  const [selected, setSelected] = useState(initial);
  const [loaded, setLoaded] = useState<{
    item: LearningPublicItem;
    problem: LearningProblem | null;
  } | null>(null);
  const [progress, setProgress] = useState(initialProgress);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const scroll = useRef(new Map<string, number>());
  const content = useRef<HTMLDivElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const prefix = `ojp:learn:${userId ?? "guest"}:${versionId}`;
  const itemPrefix = `${prefix}:${selected}`;
  const completed = new Set(
    progress.filter((entry) => entry.completed).map((entry) => entry.itemId),
  );
  const required = chapter.items.filter((item) => item.required);
  const index = chapter.items.findIndex((item) => item.id === selected);

  function switchTab(itemId: string, push = true) {
    if (
      !chapter.items.some((item) => item.id === itemId) ||
      selected === itemId
    )
      return;
    scroll.current.set(selected, window.scrollY);
    setSelected(itemId);
    setLoaded(null);
    setError("");
    if (push) {
      const url = new URL(window.location.href);
      url.searchParams.set("item", itemId);
      url.searchParams.set("version", versionId);
      window.history.pushState(null, "", url);
    }
  }
  useEffect(() => {
    const pop = () => {
      const itemId =
        new URL(window.location.href).searchParams.get("item") ??
        chapter.items[0].id;
      if (chapter.items.some((item) => item.id === itemId)) {
        scroll.current.set(selected, window.scrollY);
        setSelected(itemId);
        setLoaded(null);
      }
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [chapter.items, selected]);
  useEffect(() => {
    const abort = new AbortController();
    let cancelled = false;
    learningRequest<{
      item: LearningPublicItem;
      problem: LearningProblem | null;
    }>(
      `/api/learning/courses/${courseId}/items/${selected}?version=${versionId}`,
      { signal: abort.signal },
    )
      .then((result) => {
        if (cancelled) return;
        setLoaded(result);
        requestAnimationFrame(() => {
          tabs.current
            ?.querySelector<HTMLElement>(`[data-item-id="${selected}"]`)
            ?.scrollIntoView({ block: "nearest", inline: "nearest" });
          const offset =
            (document.querySelector(".site-header")?.getBoundingClientRect()
              .height ?? 85) + 16;
          window.scrollTo({
            top:
              scroll.current.get(selected) ??
              Math.max(
                0,
                (tabs.current?.getBoundingClientRect().top ?? 0) +
                  window.scrollY -
                  offset,
              ),
          });
        });
      })
      .catch((error) => {
        if (!cancelled)
          setError(
            error instanceof Error
              ? error.message
              : "教材を取得できませんでした。",
          );
      });
    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [courseId, versionId, selected]);

  async function record(action: string, extra: Record<string, unknown> = {}) {
    const result = await learningRequest<{
      progress: LearningProgressView[];
      quiz?: ReturnType<typeof gradeLearningQuiz>;
    }>(`/api/learning/courses/${courseId}/progress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId, itemId: selected, action, ...extra }),
    });
    setProgress(result.progress);
    return result;
  }

  return (
    <div className="stack learning-chapter">
      <div className="learning-progress-head">
        <span>{chapter.title}</span>
        <span className="text-soft">
          {t("必須項目 ")}{required.filter((item) => completed.has(item.id)).length} /{" "}
          {required.length} {t(" 完了")}</span>
      </div>
      <div
        className="learning-tab-bar"
        role="tablist"
        aria-label={t("章の教材・クイズ・練習問題")}
        ref={tabs}
      >
        {chapter.items.map((item, itemIndex) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`tab-${item.id}`}
            aria-selected={selected === item.id}
            aria-controls="learning-tabpanel"
            tabIndex={selected === item.id ? 0 : -1}
            className={`learning-tab ${selected === item.id ? "is-active" : ""} ${completed.has(item.id) ? "is-complete" : ""}`}
            data-item-id={item.id}
            onClick={() => switchTab(item.id)}
            onKeyDown={(event) => {
              let next = itemIndex;
              if (event.key === "ArrowRight")
                next = (itemIndex + 1) % chapter.items.length;
              else if (event.key === "ArrowLeft")
                next =
                  (itemIndex - 1 + chapter.items.length) % chapter.items.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = chapter.items.length - 1;
              else return;
              event.preventDefault();
              switchTab(chapter.items[next].id);
              tabs.current
                ?.querySelector<HTMLElement>(
                  `[data-item-id="${chapter.items[next].id}"]`,
                )
                ?.focus();
            }}
          >
            <span className="learning-tab-kind">
              {t(kindLabels[item.kind])}
              {!item.required ? t("・任意") : ""}
            </span>
            <span>
              {completed.has(item.id) ? "✓ " : ""}
              {item.title}
            </span>
          </button>
        ))}
      </div>
      <div
        id="learning-tabpanel"
        ref={content}
        role="tabpanel"
        aria-labelledby={`tab-${selected}`}
        tabIndex={0}
        className="panel learning-item-panel"
        key={selected}
      >
        {loaded ? (
          <div className="stack">
            <div className="learning-item-title">
              <h2 className="panel-title">{loaded.item.title}</h2>
              {completed.has(selected) ? (
                <span className="badge badge-green">{t("完了")}</span>
              ) : null}
            </div>
            {loaded.item.markdown ? (
              <LearningMarkdown
                text={loaded.item.markdown}
                cells={loaded.item.cells}
                storagePrefix={itemPrefix}
              />
            ) : null}
            {loaded.item.kind === "quiz" ? (
              <LearningQuiz
                item={loaded.item}
                storagePrefix={itemPrefix}
                signedIn={!!userId}
                submit={async (answers) =>
                  (await record("quiz", { answers })).quiz!
                }
              />
            ) : null}
            {loaded.item.kind === "problem" && loaded.problem ? (
              <LearningPractice
                problem={loaded.problem}
                storagePrefix={itemPrefix}
                signedIn={!!userId}
                allowPastAccepted={loaded.item.allowPastAccepted}
                complete={async (submissionId) => {
                  await record("problem", { submissionId });
                }}
              />
            ) : null}
            {loaded.item.kind === "lesson" ? (
              <button
                type="button"
                className="button"
                disabled={!userId || busy || completed.has(selected)}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await record("read");
                  } catch (error) {
                    setError(
                      error instanceof Error
                        ? error.message
                        : "進捗の保存に失敗しました。",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {completed.has(selected) ? t("読了済み") : busy ? t("保存中…") : t("読了にする")}
              </button>
            ) : null}
          </div>
        ) : (
          <p className="text-soft" role="status">
            {error ? t("教材を読み込めませんでした。") : t("教材を読み込んでいます…")}
          </p>
        )}
        {error ? <p role="alert">{t(error)}</p> : null}
        {!userId ? (
          <p className="text-soft">
            <Link
              className="link"
              href={`/signin?callbackUrl=${encodeURIComponent(`/learn/${courseId}/chapters/${chapter.id}?version=${versionId}&item=${selected}`)}`}
            >
              {t("ログイン")}</Link>
            {t("すると進捗を保存できます。")}</p>
        ) : null}
      </div>
      <div className="learning-pager">
        <button
          type="button"
          className="button button-secondary"
          disabled={index === 0}
          onClick={() => switchTab(chapter.items[index - 1].id)}
        >
          {t("前へ")}</button>
        <span className="text-soft">
          {index + 1} / {chapter.items.length}
        </span>
        <button
          type="button"
          className="button"
          disabled={index === chapter.items.length - 1}
          onClick={() => switchTab(chapter.items[index + 1].id)}
        >
          {t("次へ")}</button>
      </div>
    </div>
  );
}
