import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = (file) => readFileSync(file, "utf8");
const pages = [
  "app/page.tsx", "app/admin/page.tsx", "app/me/page.tsx",
  "app/problems/page.tsx", "app/problems/new/page.tsx",
  "app/problems/[problemId]/page.tsx", "app/problems/[problemId]/edit/page.tsx",
  "app/problems/[problemId]/submit/page.tsx", "app/problems/[problemId]/explanation/page.tsx",
  "app/contests/page.tsx", "app/contests/new/page.tsx",
  "app/contests/[contestId]/page.tsx", "app/contests/[contestId]/edit/page.tsx",
  "app/submissions/page.tsx", "app/submissions/[submissionId]/page.tsx",
  "app/learn/page.tsx", "app/learn/new/page.tsx", "app/learn/[courseId]/edit/page.tsx",
  "app/ratings/page.tsx", "app/reports/new/page.tsx", "app/signin/page.tsx",
];

test("page titles stand alone without redundant introductions", () => {
  for (const file of pages) {
    const text = source(file);
    assert.match(text, /<h1\b[^>]*className="page-title"/, file);
    assert.doesNotMatch(text, /className="page-subtitle"/, file);
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    assert.equal(ast.parseDiagnostics.length, 0, file);
  }
});

test("navigation, shortcut links and social links remain without promotional copy", () => {
  const home = source("app/page.tsx");
  for (const href of ["/problems", "/learn", "/contests"]) assert.ok(home.includes(`href: "${href}"`));
  assert.doesNotMatch(home, /item\.description|Find your next challenge/);
  for (const file of ["components/site-navigation.tsx", "components/site-shell.tsx"]) {
    assert.doesNotMatch(source(file), /Competitive Programming Platform/, file);
  }
  const footer = source("components/site-shell.tsx");
  for (const key of ["SITE_SOCIAL_LINKS.twitter", "SITE_SOCIAL_LINKS.github"]) assert.ok(footer.includes(key));
  assert.match(source("components/site-navigation.tsx"), /Skip to content/);
});

test("authored content, sample explanations and meaningful empty states stay visible", () => {
  assert.match(source("app/learn/[courseId]/page.tsx"), /version\.summary/);
  assert.match(source("app/learn/page.tsx"), /course\.summary/);
  assert.match(source("components/problem-samples-section.tsx"), /sample\.description/);
  assert.match(source("app/not-found.tsx"), /page-subtitle/);
  assert.match(source("components/learning-profile-summary.tsx"), /No learning progress yet\./);
  assert.match(source("app/problems/page.tsx"), /className="empty"/);
});

test("contextual warnings and validation guidance are preserved", () => {
  const submission = source("components/submission-form.tsx");
  assert.match(submission, /Flush every query/);
  assert.match(submission, /contestId && !virtualParticipationId/);
  assert.match(submission, /Contest submissions count only during the official window/);
  assert.match(submission, /Virtual submissions do not affect official standings or ratings/);
  assert.doesNotMatch(submission, /Contest submission mode:|`internal_error`/);
  assert.match(source("components/learning-course-editor.tsx"), /下書きを保存しても公開版は変わりません/);
  assert.match(source("components/profile-form.tsx"), /once every 30 days/);
  assert.match(source("components/contest-live-panel.tsx"), /cannot be reset/);
  assert.match(source("components/problem-editor-form.tsx"), /avoid leaking hidden test intent/);
  assert.match(source("components/draft-recovery.tsx"), /Review the restored content before saving/);
});

test("quiz guidance stays concise and keeps the passing threshold in both languages", () => {
  const messages = JSON.parse(source("lib/i18n/messages.json"));
  const threshold = messages["Passing score: {percent}%. Answers are graded on the server."];
  for (const locale of ["ja", "en"]) {
    assert.ok(threshold[locale].includes("{percent}%"));
    assert.doesNotMatch(threshold[locale], /server|サーバー/);
    assert.ok(messages["No learning progress yet."][locale]);
  }
});
