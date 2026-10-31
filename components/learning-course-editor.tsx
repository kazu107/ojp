"use client";

import { DraftRecovery, useDraftRecovery } from "./draft-recovery";
import { LEARNING_RUNTIME_LANGUAGES } from "@/lib/languages";
import { BRAINFUCK_HELLO_WORLD } from "@/lib/brainfuck.js";
import { useI18n } from "@/components/i18n-provider";


import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LearningMarkdown } from "./learning-markdown";
import { MarkdownBlock } from "./markdown-block";
import {
  getRunnableCells,
  newLearningItem,
  sampleLearningDraft,
  validateLearningDraft,
} from "@/lib/learning";
import type {
  LearningDraft,
  LearningItemDraft,
  LearningItemKind,
  QuizQuestion,
} from "@/lib/learning";
import { learningRequest } from "@/lib/learning-client";
import type { Visibility } from "@/lib/types";

const CodeEditor = dynamic(
  () => import("./code-editor").then((module) => module.CodeEditor),
  { ssr: false },
);
interface Props {
  initial?: {
    id: string;
    editVersion: number;
    publishedVersionId: string | null;
    draft: LearningDraft;
  };
}
const itemLabels: Record<LearningItemKind, string> = {
  lesson: "教材",
  quiz: "確認クイズ",
  problem: "練習問題",
};
function uid() {
  return crypto.randomUUID();
}

export function LearningCourseEditor({ initial }: Props) {
  const { t } = useI18n();
  const router = useRouter();
  const [draft, setDraft] = useState<LearningDraft>(
    initial?.draft ?? sampleLearningDraft(),
  );
  const [courseId, setCourseId] = useState(initial?.id);
  const [editVersion, setEditVersion] = useState(initial?.editVersion);
  const [publishedId, setPublishedId] = useState(
    initial?.publishedVersionId ?? null,
  );
  const [chapterId, setChapterId] = useState(draft.chapters[0].id);
  const [itemId, setItemId] = useState(draft.chapters[0].items[0].id);
  const [problems, setProblems] = useState<{ id: string; title: string }[]>([]);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(!initial);
  const [preview, setPreview] = useState(true);
  const recovery = useDraftRecovery({ name:`course:${courseId ?? "new"}`,base:String(editVersion ?? "new"),value:draft,enabled:!busy,restore(saved){const next=validateLearningDraft(saved);setDraft(next);setChapterId(next.chapters[0].id);setItemId(next.chapters[0].items[0].id);setDirty(true);} });
  const chapter =
    draft.chapters.find((chapter) => chapter.id === chapterId) ??
    draft.chapters[0];
  const item =
    chapter.items.find((item) => item.id === itemId) ?? chapter.items[0];
  let parsedCells: ReturnType<typeof getRunnableCells> = [];
  let markdownError = "";
  try {
    parsedCells = getRunnableCells(item.markdown);
  } catch (error) {
    markdownError = error instanceof Error ? error.message : "Invalid Markdown";
  }

  useEffect(() => {
    const abort = new AbortController();
    void learningRequest<{
      problems: { id: string; title: string; visibility: string }[];
    }>("/api/problems?limit=200", { signal: abort.signal })
      .then((result) =>
        setProblems(
          result.problems
            .filter((problem) => problem.visibility === "public")
            .map(({ id, title }) => ({ id, title })),
        ),
      )
      .catch(() => {});
    return () => abort.abort();
  }, []);
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [dirty]);
  function change(next: LearningDraft) {
    setDraft(next);
    setDirty(true);
    setMessage("");
  }
  function updateItem(patch: Partial<LearningItemDraft>) {
    change({
      ...draft,
      chapters: draft.chapters.map((entry) =>
        entry.id === chapter.id
          ? {
              ...entry,
              items: entry.items.map((entryItem) =>
                entryItem.id === item.id
                  ? { ...entryItem, ...patch }
                  : entryItem,
              ),
            }
          : entry,
      ),
    });
  }
  function updateQuestions(index: number, patch: Partial<QuizQuestion>) {
    updateItem({
      questions: item.questions.map((question, i) =>
        i === index ? { ...question, ...patch } : question,
      ),
    });
  }
  function moveChapter(offset: number) {
    const index = draft.chapters.findIndex((entry) => entry.id === chapter.id);
    if (index + offset < 0 || index + offset >= draft.chapters.length) return;
    const chapters = [...draft.chapters];
    [chapters[index], chapters[index + offset]] = [
      chapters[index + offset],
      chapters[index],
    ];
    change({ ...draft, chapters });
  }
  function moveItem(offset: number) {
    const index = chapter.items.findIndex((entry) => entry.id === item.id);
    if (index + offset < 0 || index + offset >= chapter.items.length) return;
    const items = [...chapter.items];
    [items[index], items[index + offset]] = [
      items[index + offset],
      items[index],
    ];
    change({
      ...draft,
      chapters: draft.chapters.map((entry) =>
        entry.id === chapter.id ? { ...entry, items } : entry,
      ),
    });
  }
  async function save() {
    const normalized = validateLearningDraft(draft);
    const result = await learningRequest<{ id: string; editVersion: number }>(
      courseId ? `/api/learning/courses/${courseId}` : "/api/learning/courses",
      {
        method: courseId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft: normalized, editVersion }),
      },
    );
    setCourseId(result.id);
    setEditVersion(result.editVersion);
    setDraft(normalized);
    setDirty(false);
    await recovery.clear(normalized);
    if (!courseId)
      window.history.replaceState(null, "", `/learn/${result.id}/edit`);
    return result;
  }
  async function perform(action: "save" | "publish" | "unpublish") {
    setBusy(action);
    setError("");
    setMessage("");
    try {
      const saved =
        action === "unpublish"
          ? { id: courseId!, editVersion: editVersion! }
          : await save();
      if (action !== "save") {
        const result = await learningRequest<{
          versionId?: string;
          editVersion: number;
        }>(`/api/learning/courses/${saved.id}/publish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            editVersion: saved.editVersion,
            unpublish: action === "unpublish",
          }),
        });
        setEditVersion(result.editVersion);
        setPublishedId(result.versionId ?? null);
      }
      setMessage(
        action === "save"
          ? "下書きを保存しました。公開版は変更されません。"
          : action === "publish"
            ? "新しい版を公開しました。"
            : "公開を停止しました。",
      );
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "保存に失敗しました。");
    } finally {
      setBusy("");
    }
  }
  async function importMarkdown(file: File | undefined) {
    if (!file) return;
    if (file.size > 256 * 1024) {
      setError("Markdownは256 KiB以下にしてください。");
      return;
    }
    updateItem({ markdown: (await file.text()).replace(/^\uFEFF/, "") });
  }
  async function exportZip() {
    setBusy("export");
    setError("");
    try {
      const normalized = validateLearningDraft(draft);
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      for (const chapter of normalized.chapters)
        for (const item of chapter.items)
          zip.file(`lessons/${item.id}.md`, item.markdown);
      zip.file(
        "course.json",
        JSON.stringify(
          {
            formatVersion: 1,
            ...normalized,
            chapters: normalized.chapters.map((chapter) => ({
              ...chapter,
              items: chapter.items.map((item) => ({
                ...item,
                markdown: "",
                markdownFile: `lessons/${item.id}.md`,
              })),
            })),
          },
          null,
          2,
        ),
      );
      const blob = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${normalized.slug}.zip`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "書き出しに失敗しました。",
      );
    } finally {
      setBusy("");
    }
  }
  async function importZip(file: File | undefined) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError("教材ZIPは2 MiB以下にしてください。");
      return;
    }
    setBusy("import");
    setError("");
    try {
      const { importLearningZip } = await import("@/lib/learning-zip");
      const result = await importLearningZip(
        new Uint8Array(await file.arrayBuffer()),
      );
      change(result);
      setChapterId(result.chapters[0].id);
      setItemId(result.chapters[0].items[0].id);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "ZIP取り込みに失敗しました。",
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <fieldset className="stack learning-editor" disabled={!!busy}>
      <DraftRecovery draft={recovery} />
      <div className="learning-toolbar">
        <div className="button-row">
          <button
            type="button"
            className="button button-secondary"
            disabled={!!busy}
            onClick={() => void perform("save")}
          >
            {busy === "save" ? t("保存中…") : t("下書き保存")}
          </button>
          <button
            type="button"
            className="button"
            disabled={!!busy}
            onClick={() => void perform("publish")}
          >
            {busy === "publish" ? t("Markdownを保存して公開中…") : t("保存して公開")}
          </button>
          {publishedId ? (
            <>
              <Link
                className="button button-secondary"
                href={`/learn/${courseId}`}
              >
                {t("公開版を確認")}</Link>
              <button
                type="button"
                className="button button-danger"
                disabled={!!busy}
                onClick={() => {
                  if (
                    window.confirm(
                      t("このコースの公開を停止しますか？進捗と過去の版は削除されません。"),
                    )
                  )
                    void perform("unpublish");
                }}
              >
                {t("公開停止")}</button>
            </>
          ) : null}
        </div>
        <span className="text-soft">
          {dirty ? t("未保存の変更あり") : t("保存済み")}
        </span>
      </div>
      {message ? (
        <p role="status" className="badge badge-green">
          {t(message)}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="learning-error">
          {t(error)}
        </p>
      ) : null}
      <section className="panel form">
        <h2 className="panel-title">{t("コース設定")}</h2>
        <div className="grid-2">
          <label className="field">
            <span className="field-label">{t("コース名")}</span>
            <input
              className="input"
              value={draft.title}
              maxLength={160}
              onChange={(event) =>
                change({ ...draft, title: event.target.value })
              }
            />
          </label>
          <label className="field">
            <span className="field-label">{t("識別名（半角英数字・ハイフン）")}</span>
            <input
              className="input"
              value={draft.slug}
              maxLength={80}
              onChange={(event) =>
                change({ ...draft, slug: event.target.value })
              }
            />
          </label>
        </div>
        <label className="field">
          <span className="field-label">{t("概要")}</span>
          <textarea
            className="textarea"
            rows={2}
            maxLength={2000}
            value={draft.summary}
            onChange={(event) =>
              change({ ...draft, summary: event.target.value })
            }
          />
        </label>
        <label className="field">
          <span className="field-label">{t("公開範囲")}</span>
          <select
            className="select"
            value={draft.visibility}
            onChange={(event) =>
              change({ ...draft, visibility: event.target.value as Visibility })
            }
          >
            <option value="private">{t("作成者・管理者のみ")}</option>
            <option value="unlisted">{t("リンクを知っている人")}</option>
            <option value="public">{t("全体に公開")}</option>
          </select>
        </label>
        <div className="button-row">
          <button
            type="button"
            className="button button-secondary"
            disabled={!!busy}
            onClick={() => void exportZip()}
          >
            {t("現在の内容をZIPでダウンロード")}</button>
          <label className="button button-secondary">
            {t("ZIPから取り込む")}<input
              type="file"
              accept=".zip"
              hidden
              disabled={!!busy}
              onChange={(event) => {
                void importZip(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
        </div>
        <p className="learning-caption">
          {t("ZIPにはcourse.jsonと教材のMarkdownが入ります。正解・解説も含むため、作成者用ファイルとして扱ってください。公開範囲の変更は公開操作時に反映します。")}</p>
      </section>
      <div className="learning-editor-grid">
        <aside className="panel stack learning-editor-index">
          <h2 className="panel-title">{t("章とタブ")}</h2>
          {draft.chapters.map((entry) => (
            <div key={entry.id} className="learning-editor-chapter">
              <button
                type="button"
                className={`learning-index-button ${entry.id === chapter.id ? "is-active" : ""}`}
                onClick={() => {
                  setChapterId(entry.id);
                  setItemId(entry.items[0].id);
                }}
              >
                {entry.title}
              </button>
              {entry.id === chapter.id
                ? entry.items.map((entryItem) => (
                    <button
                      type="button"
                      key={entryItem.id}
                      className={`learning-index-button learning-index-item ${entryItem.id === item.id ? "is-active" : ""}`}
                      onClick={() => setItemId(entryItem.id)}
                    >
                      <span className="learning-tab-kind">
                        {t(itemLabels[entryItem.kind])}
                      </span>
                      {entryItem.title}
                    </button>
                  ))
                : null}
            </div>
          ))}
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              const next = {
                id: uid(),
                title: `第${draft.chapters.length + 1}章`,
                items: [newLearningItem("lesson", uid())],
              };
              change({ ...draft, chapters: [...draft.chapters, next] });
              setChapterId(next.id);
              setItemId(next.items[0].id);
            }}
          >
            {t("章を追加")}</button>
        </aside>
        <section className="panel stack" key={item.id}>
          <label className="field">
            <span className="field-label">{t("章の名前")}</span>
            <input
              className="input"
              value={chapter.title}
              onChange={(event) =>
                change({
                  ...draft,
                  chapters: draft.chapters.map((entry) =>
                    entry.id === chapter.id
                      ? { ...entry, title: event.target.value }
                      : entry,
                  ),
                })
              }
            />
          </label>
          <div className="button-row">
            <button
              type="button"
              className="button button-secondary"
              onClick={() => moveChapter(-1)}
            >
              {t("章を上へ")}</button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => moveChapter(1)}
            >
              {t("章を下へ")}</button>
            <button
              type="button"
              className="button button-danger"
              disabled={draft.chapters.length <= 1}
              onClick={() => {
                if (
                  !window.confirm(t("この章と中の教材を下書きから削除しますか？"))
                )
                  return;
                const chapters = draft.chapters.filter(
                  (entry) => entry.id !== chapter.id,
                );
                change({ ...draft, chapters });
                setChapterId(chapters[0].id);
                setItemId(chapters[0].items[0].id);
              }}
            >
              {t("章を削除")}</button>
          </div>
          <div className="button-row">
            {(["lesson", "quiz", "problem"] as LearningItemKind[]).map(
              (kind) => (
                <button
                  key={kind}
                  type="button"
                  className="button button-secondary"
                  onClick={() => {
                    const next = newLearningItem(kind, uid());
                    change({
                      ...draft,
                      chapters: draft.chapters.map((entry) =>
                        entry.id === chapter.id
                          ? { ...entry, items: [...entry.items, next] }
                          : entry,
                      ),
                    });
                    setItemId(next.id);
                  }}
                >
                  {t("Add {label}", { label: t(itemLabels[kind]) })}</button>
              ),
            )}
          </div>
          <hr className="learning-divider" />
          <label className="field">
            <span className="field-label">{t("タブの名前")}</span>
            <input
              className="input"
              value={item.title}
              onChange={(event) => updateItem({ title: event.target.value })}
            />
          </label>
          <label className="learning-option">
            <input
              type="checkbox"
              checked={item.required}
              onChange={(event) =>
                updateItem({ required: event.target.checked })
              }
            />
            {t("コース完了に必須")}</label>
          <div className="button-row">
            <button
              type="button"
              className="button button-secondary"
              onClick={() => moveItem(-1)}
            >
              {t("タブを前へ")}</button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => moveItem(1)}
            >
              {t("タブを後ろへ")}</button>
            <button
              type="button"
              className="button button-danger"
              disabled={chapter.items.length <= 1}
              onClick={() => {
                if (!window.confirm(t("このタブを下書きから削除しますか？")))
                  return;
                const items = chapter.items.filter(
                  (entry) => entry.id !== item.id,
                );
                change({
                  ...draft,
                  chapters: draft.chapters.map((entry) =>
                    entry.id === chapter.id ? { ...entry, items } : entry,
                  ),
                });
                setItemId(items[0].id);
              }}
            >
              {t("タブを削除")}</button>
          </div>
          <div className="field">
            <span className="field-label">{t("本文・補足（Markdown）")}</span>
            <CodeEditor
              language="markdown"
              readOnly={!!busy}
              value={item.markdown}
              onChange={(markdown) => updateItem({ markdown })}
              minHeight={280}
            />
          </div>
          <div className="button-row">
            <label className="button button-secondary">
              {t(".mdファイルを取り込む")}<input
                hidden
                type="file"
                accept=".md,.markdown,text/markdown,text/plain"
                onChange={(event) => {
                  void importMarkdown(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>
            {LEARNING_RUNTIME_LANGUAGES.map((language) => (
              <button
                type="button"
                className="button button-secondary"
                key={language}
                onClick={() => {
                  const cellId = `cell-${uid().slice(0, 8)}`;
                  updateItem({
                    markdown: `${item.markdown}\n\n\`\`\`${language} run id=${cellId}\n${language === "brainfuck" ? BRAINFUCK_HELLO_WORLD : language === "python" ? 'print("Hello, OJP!")' : 'console.log("Hello, OJP!");'}\n\`\`\`\n`,
                    cells: {
                      ...item.cells,
                      [cellId]: { stdin: "", readOnly: false },
                    },
                  });
                }}
              >
                {t("Insert {language} Code Cell", { language })}</button>
            ))}
          </div>
          {parsedCells.map((cell) => (
            <details key={cell.id} className="learning-cell-settings">
              <summary>{t("Code Cell {id} Settings", { id: cell.id })}</summary>
              <label className="field">
                <span className="field-label">{t("標準入力の初期値")}</span>
                <textarea
                  className="textarea mono"
                  rows={3}
                  value={item.cells[cell.id]?.stdin ?? ""}
                  onChange={(event) =>
                    updateItem({
                      cells: {
                        ...item.cells,
                        [cell.id]: {
                          stdin: event.target.value,
                          readOnly: item.cells[cell.id]?.readOnly ?? false,
                        },
                      },
                    })
                  }
                />
              </label>
              <label className="learning-option">
                <input
                  type="checkbox"
                  checked={item.cells[cell.id]?.readOnly ?? false}
                  onChange={(event) =>
                    updateItem({
                      cells: {
                        ...item.cells,
                        [cell.id]: {
                          stdin: item.cells[cell.id]?.stdin ?? "",
                          readOnly: event.target.checked,
                        },
                      },
                    })
                  }
                />
                {t("学習者によるコード編集を禁止する")}</label>
            </details>
          ))}
          <label className="learning-option">
            <input
              type="checkbox"
              checked={preview}
              onChange={(event) => setPreview(event.target.checked)}
            />
            {t("ライブプレビューを表示")}</label>
          {markdownError ? (
            <p role="alert">{t(markdownError)}</p>
          ) : preview ? (
            <section className="learning-preview">
              <h3 className="panel-title">{t("学習者表示のプレビュー")}</h3>
              <LearningMarkdown
                text={item.markdown}
                cells={item.cells}
                storagePrefix={`ojp:learn:preview:${courseId ?? "new"}:${item.id}`}
              />
            </section>
          ) : null}
          {item.kind === "quiz" ? (
            <div className="stack">
              <h3 className="panel-title">{t("確認クイズ")}</h3>
              <label className="field">
                <span className="field-label">{t("合格率（%）")}</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={100}
                  value={item.passingPercent}
                  onChange={(event) =>
                    updateItem({ passingPercent: Number(event.target.value) })
                  }
                />
              </label>
              {item.questions.map((question, index) => (
                <fieldset className="learning-question stack" key={question.id}>
                  <legend>{t("問 ")}{index + 1}</legend>
                  <label className="field">
                    <span className="field-label">{t("設問（Markdown）")}</span>
                    <textarea
                      className="textarea"
                      value={question.prompt}
                      onChange={(event) =>
                        updateQuestions(index, { prompt: event.target.value })
                      }
                    />
                  </label>
                  <MarkdownBlock text={question.prompt} />
                  {question.options.map((option) => (
                    <label className="learning-option" key={option.id}>
                      <input
                        type="radio"
                        name={`correct-${question.id}`}
                        checked={question.answerId === option.id}
                        onChange={() =>
                          updateQuestions(index, { answerId: option.id })
                        }
                      />
                      <input
                        aria-label={t("選択肢")}
                        className="input"
                        value={option.text}
                        onChange={(event) =>
                          updateQuestions(index, {
                            options: question.options.map((entry) =>
                              entry.id === option.id
                                ? { ...entry, text: event.target.value }
                                : entry,
                            ),
                          })
                        }
                      />
                      <button
                        type="button"
                        className="button button-secondary"
                        disabled={question.options.length <= 2}
                        onClick={() => {
                          const options = question.options.filter(
                            (entry) => entry.id !== option.id,
                          );
                          updateQuestions(index, {
                            options,
                            answerId:
                              question.answerId === option.id
                                ? options[0].id
                                : question.answerId,
                          });
                        }}
                      >
                        {t("削除")}</button>
                    </label>
                  ))}
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={question.options.length >= 8}
                    onClick={() =>
                      updateQuestions(index, {
                        options: [
                          ...question.options,
                          { id: uid(), text: "新しい選択肢" },
                        ],
                      })
                    }
                  >
                    {t("選択肢を追加")}</button>
                  <p className="learning-caption">
                    {t("ラジオボタンで正解を指定します。")}</p>
                  <label className="field">
                    <span className="field-label">
                      {t("回答後の解説（Markdown）")}</span>
                    <textarea
                      className="textarea"
                      value={question.explanation}
                      onChange={(event) =>
                        updateQuestions(index, {
                          explanation: event.target.value,
                        })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="button button-danger"
                    disabled={item.questions.length <= 1}
                    onClick={() =>
                      updateItem({
                        questions: item.questions.filter(
                          (entry) => entry.id !== question.id,
                        ),
                      })
                    }
                  >
                    {t("設問を削除")}</button>
                </fieldset>
              ))}
              <button
                type="button"
                className="button button-secondary"
                onClick={() =>
                  updateItem({
                    questions: [
                      ...item.questions,
                      {
                        ...newLearningItem("quiz", uid()).questions[0],
                        id: uid(),
                      },
                    ],
                  })
                }
              >
                {t("設問を追加")}</button>
            </div>
          ) : null}
          {item.kind === "problem" ? (
            <div className="stack">
              <h3 className="panel-title">{t("練習問題の関連付け")}</h3>
              <label className="field">
                <span className="field-label">{t("公開済み問題")}</span>
                <select
                  className="select"
                  value={item.problemId}
                  onChange={(event) =>
                    updateItem({ problemId: event.target.value })
                  }
                >
                  <option value="">{t("問題を選択")}</option>
                  {problems.map((problem) => (
                    <option key={problem.id} value={problem.id}>
                      {problem.title} ({problem.id})
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">{t("問題ID（一覧にない場合）")}</span>
                <input
                  className="input"
                  value={item.problemId}
                  onChange={(event) =>
                    updateItem({ problemId: event.target.value })
                  }
                />
              </label>
              <label className="learning-option">
                <input
                  type="checkbox"
                  checked={item.allowPastAccepted}
                  onChange={(event) =>
                    updateItem({ allowPastAccepted: event.target.checked })
                  }
                />
                {t("公開前のAC提出でも完了にできる")}</label>
              <p className="learning-caption">
                {t("既存ジャッジを利用します。非公開問題へのアクセスは付与しません。")}</p>
            </div>
          ) : null}
        </section>
      </div>
    </fieldset>
  );
}
