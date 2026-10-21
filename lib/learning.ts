import { unified } from "unified";
import remarkParse from "remark-parse";
import type { Root, Code } from "mdast";
import type { Visibility } from "./types";

export type LearningItemKind = "lesson" | "quiz" | "problem";
export interface CellSettings {
  stdin: string;
  readOnly: boolean;
}
export interface QuizQuestion {
  id: string;
  prompt: string;
  options: { id: string; text: string }[];
  answerId: string;
  explanation: string;
}
export interface LearningItemDraft {
  id: string;
  title: string;
  kind: LearningItemKind;
  required: boolean;
  markdown: string;
  cells: Record<string, CellSettings>;
  questions: QuizQuestion[];
  passingPercent: number;
  problemId: string;
  allowPastAccepted: boolean;
}
export interface LearningChapter {
  id: string;
  title: string;
  items: LearningItemDraft[];
}
export interface LearningDraft {
  title: string;
  slug: string;
  summary: string;
  visibility: Visibility;
  chapters: LearningChapter[];
}
export interface LearningOutlineItem {
  id: string;
  title: string;
  kind: LearningItemKind;
  required: boolean;
}
export interface LearningOutlineChapter {
  id: string;
  title: string;
  items: LearningOutlineItem[];
}
export interface LearningOutline {
  chapters: LearningOutlineChapter[];
}
export interface LearningPublicItem {
  id: string;
  title: string;
  kind: LearningItemKind;
  required: boolean;
  markdown: string;
  cells: Record<string, CellSettings>;
  questions: Omit<QuizQuestion, "answerId" | "explanation">[];
  passingPercent: number;
  problemId: string;
  allowPastAccepted: boolean;
}
export interface LearningProgressView {
  itemId: string;
  completed: boolean;
  score: number;
  attempts: number;
}
export interface RunnableCell {
  id: string;
  language: "python" | "javascript";
  source: string;
}
export const LEARNING_MAX_BODY_BYTES = 2 * 1024 * 1024;
export const LEARNING_MAX_OUTPUT = 64 * 1024;
export const LEARNING_EXECUTION_MS = 10_000;
export const LEARNING_PREPARATION_MS = 90_000;

export class LearningError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export function visitMarkdownCodes(root: Root, callback: (node: Code) => void) {
  function walk(node: Root | Root["children"][number]) {
    if (node.type === "code") callback(node);
    if ("children" in node)
      for (const child of node.children)
        walk(child as Root["children"][number]);
  }
  walk(root);
}

export function runnableCell(node: Code): RunnableCell | null {
  const meta = node.meta?.trim().split(/\s+/) ?? [];
  if (!meta.includes("run")) return null;
  if (node.lang !== "python" && node.lang !== "javascript") {
    throw new LearningError(
      "Runnable cells support python or javascript only.",
    );
  }
  const id = meta.find((part) => part.startsWith("id="))?.slice(3);
  if (
    !id ||
    !/^[a-zA-Z0-9_-]{1,80}$/.test(id) ||
    ["__proto__", "constructor", "prototype"].includes(id)
  ) {
    throw new LearningError(
      "Every runnable code block needs a stable id, e.g. python run id=hello.",
    );
  }
  if (
    meta.some((part) => part !== "run" && part !== `id=${id}`) ||
    meta.length !== 2
  ) {
    throw new LearningError("Code block options must be: run id=<unique-id>.");
  }
  return { id, language: node.lang, source: node.value };
}

export function getRunnableCells(markdown: string): RunnableCell[] {
  const cells: RunnableCell[] = [];
  const seen = new Set<string>();
  visitMarkdownCodes(
    unified().use(remarkParse).parse(markdown) as Root,
    (node) => {
      const cell = runnableCell(node);
      if (!cell) return;
      if (seen.has(cell.id))
        throw new LearningError(`Duplicate code cell id: ${cell.id}`);
      seen.add(cell.id);
      cells.push(cell);
    },
  );
  if (cells.length > 20)
    throw new LearningError("A lesson can contain at most 20 runnable cells.");
  return cells;
}

function record(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new LearningError("Invalid learning document.");
  return raw as Record<string, unknown>;
}
function str(
  raw: unknown,
  label: string,
  max: number,
  required = false,
): string {
  if (
    typeof raw !== "string" ||
    raw.length > max ||
    (required && !raw.trim())
  ) {
    throw new LearningError(
      `${label} must be ${required ? "non-empty and " : ""}at most ${max} characters.`,
    );
  }
  return raw;
}
function id(raw: unknown): string {
  const value = str(raw, "ID", 80, true);
  if (
    !/^[a-zA-Z0-9_-]+$/.test(value) ||
    ["__proto__", "constructor", "prototype"].includes(value)
  )
    throw new LearningError(
      "IDs may contain letters, digits, _ and - only and must not use reserved names.",
    );
  return value;
}

export function validateLearningDraft(raw: unknown): LearningDraft {
  const doc = record(raw);
  const title = str(doc.title, "Title", 160, true).trim();
  const slug = str(doc.slug, "Slug", 80, true).trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    throw new LearningError(
      "Slug must use lowercase letters, digits and hyphens.",
    );
  if (!["public", "unlisted", "private"].includes(String(doc.visibility)))
    throw new LearningError("Invalid visibility.");
  if (
    !Array.isArray(doc.chapters) ||
    doc.chapters.length < 1 ||
    doc.chapters.length > 50
  )
    throw new LearningError("A course needs 1-50 chapters.");
  const allIds = new Set<string>();
  const uniqueId = (raw: unknown) => {
    const value = id(raw);
    if (allIds.has(value))
      throw new LearningError(`Duplicate chapter/item ID: ${value}`);
    allIds.add(value);
    return value;
  };
  let count = 0;
  const chapters = doc.chapters.map((rawChapter) => {
    const chapter = record(rawChapter);
    const chapterId = uniqueId(chapter.id);
    if (
      !Array.isArray(chapter.items) ||
      chapter.items.length < 1 ||
      chapter.items.length > 50
    )
      throw new LearningError("Each chapter needs 1-50 items.");
    const items = chapter.items.map((rawItem): LearningItemDraft => {
      if (++count > 200)
        throw new LearningError("A course can contain at most 200 items.");
      const item = record(rawItem);
      const itemId = uniqueId(item.id);
      if (!["lesson", "quiz", "problem"].includes(String(item.kind)))
        throw new LearningError("Invalid item kind.");
      const kind = item.kind as LearningItemKind;
      const markdown = str(item.markdown ?? "", "Markdown", 256 * 1024);
      const cells: Record<string, CellSettings> = {};
      const rawCells = record(item.cells ?? {});
      for (const cell of getRunnableCells(markdown)) {
        const settings =
          rawCells[cell.id] === undefined ? {} : record(rawCells[cell.id]);
        cells[cell.id] = {
          stdin: str(settings.stdin ?? "", "Standard input", 64 * 1024),
          readOnly: settings.readOnly === true,
        };
      }
      const questions: QuizQuestion[] = [];
      if (kind === "quiz") {
        if (
          !Array.isArray(item.questions) ||
          item.questions.length < 1 ||
          item.questions.length > 30
        )
          throw new LearningError("A quiz needs 1-30 questions.");
        const questionIds = new Set<string>();
        for (const rawQuestion of item.questions) {
          const question = record(rawQuestion);
          const questionId = id(question.id);
          if (questionIds.has(questionId))
            throw new LearningError("Duplicate question ID.");
          questionIds.add(questionId);
          if (
            !Array.isArray(question.options) ||
            question.options.length < 2 ||
            question.options.length > 8
          )
            throw new LearningError("Questions need 2-8 options.");
          const options = question.options.map((rawOption) => {
            const option = record(rawOption);
            return {
              id: id(option.id),
              text: str(option.text, "Option", 2000, true),
            };
          });
          if (
            new Set(options.map((option) => option.id)).size !== options.length
          )
            throw new LearningError("Duplicate option ID.");
          const answerId = id(question.answerId);
          if (!options.some((option) => option.id === answerId))
            throw new LearningError("Correct answer must reference an option.");
          questions.push({
            id: questionId,
            prompt: str(question.prompt, "Question", 8000, true),
            options,
            answerId,
            explanation: str(question.explanation ?? "", "Explanation", 8000),
          });
        }
      }
      const passingPercent = item.passingPercent ?? 100;
      if (
        !Number.isInteger(passingPercent) ||
        (passingPercent as number) < 1 ||
        (passingPercent as number) > 100
      )
        throw new LearningError("Passing percentage must be 1-100.");
      return {
        id: itemId,
        title: str(item.title, "Item title", 160, true).trim(),
        kind,
        required: item.required !== false,
        markdown,
        cells,
        questions,
        passingPercent: passingPercent as number,
        problemId: str(
          item.problemId ?? "",
          "Problem ID",
          160,
          kind === "problem",
        ),
        allowPastAccepted: item.allowPastAccepted !== false,
      };
    });
    return {
      id: chapterId,
      title: str(chapter.title, "Chapter title", 160, true).trim(),
      items,
    };
  });
  const result: LearningDraft = {
    title,
    slug,
    summary: str(doc.summary ?? "", "Summary", 2000),
    visibility: doc.visibility as Visibility,
    chapters,
  };
  if (
    new TextEncoder().encode(JSON.stringify(result)).length >
    LEARNING_MAX_BODY_BYTES
  )
    throw new LearningError("A course document must be at most 2 MiB.");
  return result;
}

export function learningOutline(draft: LearningDraft): LearningOutline {
  return {
    chapters: draft.chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      items: chapter.items.map(({ id, title, kind, required }) => ({
        id,
        title,
        kind,
        required,
      })),
    })),
  };
}
export function publicLearningItem(
  item: LearningItemDraft,
): LearningPublicItem {
  return {
    ...item,
    questions: item.questions.map(({ id, prompt, options }) => ({
      id,
      prompt,
      options,
    })),
  };
}
export function gradeLearningQuiz(
  item: LearningItemDraft,
  rawAnswers: unknown,
) {
  if (item.kind !== "quiz") throw new LearningError("This item is not a quiz.");
  const answers = record(rawAnswers);
  if (
    Object.keys(answers).some(
      (key) => !item.questions.some((question) => question.id === key),
    )
  )
    throw new LearningError("Unknown question.");
  const results = item.questions.map((question) => {
    if (!question.options.some((option) => option.id === answers[question.id]))
      throw new LearningError("Answer every question before submitting.");
    return {
      questionId: question.id,
      correct: answers[question.id] === question.answerId,
      answerId: question.answerId,
      explanation: question.explanation,
    };
  });
  const correct = results.filter((result) => result.correct).length;
  // Compare exact ratios so rounding cannot turn a failing attempt into a pass.
  return {
    score: Math.floor((correct * 100) / results.length),
    passed: correct * 100 >= item.passingPercent * results.length,
    results,
  };
}

export function newLearningItem(
  kind: LearningItemKind,
  itemId: string,
): LearningItemDraft {
  return {
    id: itemId,
    title:
      kind === "lesson" ? "教材" : kind === "quiz" ? "確認クイズ" : "練習問題",
    kind,
    required: true,
    markdown: "",
    cells: {},
    questions:
      kind === "quiz"
        ? [
            {
              id: "q1",
              prompt: "設問を入力してください。",
              options: [
                { id: "a", text: "選択肢 A" },
                { id: "b", text: "選択肢 B" },
              ],
              answerId: "a",
              explanation: "",
            },
          ]
        : [],
    passingPercent: 100,
    problemId: "",
    allowPastAccepted: true,
  };
}
export function sampleLearningDraft(): LearningDraft {
  const first = newLearningItem("lesson", "input");
  first.title = "入力を受け取る";
  first.markdown =
    '## 入力を受け取る\n\nコードを変更して実行してみましょう。\n\n```python run id=greeting\nname = input()\nprint(f"こんにちは、{name}さん")\n```\n\n`input()` は入力を文字列として読み取ります。';
  first.cells = { greeting: { stdin: "OJP\n", readOnly: false } };
  const second = newLearningItem("lesson", "output");
  second.title = "出力する";
  second.markdown =
    "## 出力する\n\n`print()` で出力できます。\n\n```python run id=printing\nprint(1 + 2)\n```\n\n- 数値も文字列も出力できます。\n- 数式も使えます：$a + b$。";
  const quiz = newLearningItem("quiz", "check");
  quiz.questions[0].prompt = "`input()` の戻り値の型はどれですか？";
  quiz.questions[0].options = [
    { id: "a", text: "文字列 (str)" },
    { id: "b", text: "整数 (int)" },
  ];
  quiz.questions[0].explanation =
    "整数として使う場合は int(input()) と変換します。";
  return {
    title: "Python 入門",
    slug: "python-introduction",
    summary: "教材・実行欄・確認クイズで学ぶ入出力の基本。",
    visibility: "private",
    chapters: [
      { id: "basics", title: "第1章：入出力", items: [first, second, quiz] },
    ],
  };
}
