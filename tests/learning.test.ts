import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import {
  getRunnableCells,
  gradeLearningQuiz,
  learningOutline,
  publicLearningItem,
  sampleLearningDraft,
  validateLearningDraft,
} from "../lib/learning";
import { importLearningZip } from "../lib/learning-zip";
import { readLearningBody } from "../lib/learning-api";

test("sample course validates with stable IDs and multiple chapter tabs", () => {
  const draft = validateLearningDraft(sampleLearningDraft());
  assert.equal(draft.chapters[0].items.length, 3);
  assert.deepEqual(
    learningOutline(draft).chapters[0].items.map((item) => item.kind),
    ["lesson", "lesson", "quiz"],
  );
  assert.equal(draft.chapters[0].items[0].cells.greeting.stdin, "OJP\n");
});
test("ordinary fences stay static and nested fences do not become executable", () => {
  assert.equal(getRunnableCells("```python\nprint(1)\n```").length, 0);
  assert.equal(
    getRunnableCells(
      "````markdown\n```python run id=example\nprint(1)\n```\n````",
    ).length,
    0,
  );
  assert.equal(
    getRunnableCells(
      "- Example\n\n  ```python run id=nested\n  print(1)\n  ```",
    )[0].id,
    "nested",
  );
});
test("code cells reject missing, duplicate, reserved IDs and unsupported languages", () => {
  assert.throws(
    () => getRunnableCells("```python run\npass\n```"),
    /stable id/,
  );
  assert.throws(
    () =>
      getRunnableCells(
        "```python run id=x\npass\n```\n```python run id=x\npass\n```",
      ),
    /Duplicate/,
  );
  assert.throws(
    () => getRunnableCells("```python run id=__proto__\npass\n```"),
    /stable id/,
  );
  assert.throws(
    () => getRunnableCells("```cpp run id=x\nint main(){}\n```"),
    /support/,
  );
});
test("Brainfuck lessons validate stable cells and round trip through learning ZIP", async () => {
  const draft = sampleLearningDraft();
  draft.chapters[0].items[0].markdown = "```brainfuck run id=bf-echo\n,[.,]\n```";
  draft.chapters[0].items[0].cells = { "bf-echo": { stdin: "Hello\n", readOnly: false } };
  const checked = validateLearningDraft(draft);
  assert.equal(getRunnableCells(checked.chapters[0].items[0].markdown)[0].language, "brainfuck");
  const zip = new JSZip();
  for (const chapter of checked.chapters) for (const item of chapter.items) {
    zip.file(`lessons/${item.id}.md`, item.markdown);
  }
  zip.file("course.json", JSON.stringify({
    formatVersion: 1, ...checked,
    chapters: checked.chapters.map((chapter) => ({ ...chapter,
      items: chapter.items.map((item) => ({ ...item, markdown: "", markdownFile: `lessons/${item.id}.md` })),
    })),
  }));
  assert.deepEqual(await importLearningZip(await zip.generateAsync({ type: "uint8array" })), checked);
});

test("learning outline and learner quiz never expose correct answers or explanations", () => {
  const draft = sampleLearningDraft();
  assert.ok(!JSON.stringify(learningOutline(draft)).includes("answerId"));
  const visible = publicLearningItem(draft.chapters[0].items[2]);
  assert.ok(!JSON.stringify(visible).includes("answerId"));
  assert.ok(!("explanation" in visible.questions[0]));
});
test("server quiz scoring validates all answers and exact passing ratios", () => {
  const quiz = sampleLearningDraft().chapters[0].items[2];
  assert.equal(gradeLearningQuiz(quiz, { q1: "a" }).passed, true);
  assert.equal(gradeLearningQuiz(quiz, { q1: "b" }).score, 0);
  assert.throws(() => gradeLearningQuiz(quiz, {}), /every question/);
  assert.throws(
    () => gradeLearningQuiz(quiz, { q1: "a", unknown: "a" }),
    /Unknown/,
  );
  const questions = [0, 1, 2].map((i) => ({
    ...quiz.questions[0],
    id: `q${i}`,
  }));
  assert.equal(
    gradeLearningQuiz(
      { ...quiz, questions, passingPercent: 67 },
      { q0: "a", q1: "a", q2: "b" },
    ).passed,
    false,
  );
});
test("draft validation rejects ID collisions, malformed quizzes and oversized content", () => {
  const draft = sampleLearningDraft();
  draft.chapters[0].items[1].id = draft.chapters[0].items[0].id;
  assert.throws(() => validateLearningDraft(draft), /Duplicate/);
  const broken = sampleLearningDraft();
  broken.chapters[0].items[2].questions[0].answerId = "missing";
  assert.throws(() => validateLearningDraft(broken), /Correct answer/);
  const large = sampleLearningDraft();
  large.chapters[0].items[0].markdown = "x".repeat(256 * 1024 + 1);
  assert.throws(() => validateLearningDraft(large), /Markdown/);
});
test("ZIP import round trips Markdown, cell settings and quiz answers", async () => {
  const draft = sampleLearningDraft();
  const zip = new JSZip();
  for (const chapter of draft.chapters)
    for (const item of chapter.items)
      zip.file(`lessons/${item.id}.md`, item.markdown);
  zip.file(
    "course.json",
    JSON.stringify({
      formatVersion: 1,
      ...draft,
      chapters: draft.chapters.map((chapter) => ({
        ...chapter,
        items: chapter.items.map((item) => ({
          ...item,
          markdown: "",
          markdownFile: `lessons/${item.id}.md`,
        })),
      })),
    }),
  );
  assert.deepEqual(
    await importLearningZip(await zip.generateAsync({ type: "uint8array" })),
    validateLearningDraft(draft),
  );
});
test("ZIP import rejects unsafe paths and large expanded content", async () => {
  const bad = new JSZip();
  bad.file("../course.json", "{}");
  await assert.rejects(
    importLearningZip(await bad.generateAsync({ type: "uint8array" })),
    /Unsafe/,
  );
  const bomb = new JSZip();
  bomb.file("huge.md", "0".repeat(3 * 1024 * 1024));
  await assert.rejects(
    importLearningZip(
      await bomb.generateAsync({ type: "uint8array", compression: "DEFLATE" }),
    ),
    /Expanded/,
  );
});
test("API request byte limit works without Content-Length", async () => {
  const request = new Request("http://localhost/", {
    method: "POST",
    body: "x".repeat(2 * 1024 * 1024 + 1),
  });
  await assert.rejects(readLearningBody(request), /exceeds/);
  await assert.rejects(
    readLearningBody(
      new Request("http://localhost/", { method: "POST", body: "invalid" }),
    ),
    /Invalid JSON/,
  );
});

test("ZIP inflation is bounded even when central-directory sizes lie", async () => {
  const draft = sampleLearningDraft();
  const zip = new JSZip();
  for (const chapter of draft.chapters)
    for (const item of chapter.items)
      zip.file(
        `lessons/${item.id}.md`,
        item.id === "input" ? "x".repeat(3 * 1024 * 1024) : item.markdown,
      );
  zip.file(
    "course.json",
    JSON.stringify({
      formatVersion: 1,
      ...draft,
      chapters: draft.chapters.map((chapter) => ({
        ...chapter,
        items: chapter.items.map((item) => ({
          ...item,
          markdown: "",
          markdownFile: `lessons/${item.id}.md`,
        })),
      })),
    }),
  );
  const bytes = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
  });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset < bytes.length - 46; offset++) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const length = view.getUint16(offset + 28, true);
    if (
      new TextDecoder().decode(
        bytes.subarray(offset + 46, offset + 46 + length),
      ) === "lessons/input.md"
    ) {
      view.setUint32(offset + 24, 1, true);
      break;
    }
  }
  await assert.rejects(importLearningZip(bytes), /Expanded ZIP exceeds/);
});
