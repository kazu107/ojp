import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import messages from "../lib/i18n/messages.json";
import { createTranslator, normalizeLocale, translate } from "../lib/i18n/shared";
import { formatDate } from "../lib/presentation";

test("locale is restricted to Japanese or English, defaulting to Japanese", () => {
  for (const value of [undefined, null, "", "fr", "EN", "__proto__", {}]) {
    assert.equal(normalizeLocale(value), "ja");
  }
  assert.equal(normalizeLocale("en"), "en");
  assert.equal(normalizeLocale("ja"), "ja");
});

test("UI translations and interpolation preserve literal user values and whitespace", () => {
  const ja = createTranslator("ja");
  const en = createTranslator("en");
  assert.equal(ja("Problems"), "問題");
  assert.equal(en("学習"), "Learn");
  assert.equal(ja(" Input "), " 入力 ");
  assert.equal(en("  \n "), "  \n ");
  assert.equal(en(""), "");
  assert.equal(en("Add {label}", { label: "Problems {value0}" }), "Add Problems {value0}");
  assert.equal(ja("{value0} / {value1} 完了", { value0: 1, value1: 3 }), "1 / 3 完了");
  assert.equal(en("{value0} / {value1} 完了", { value0: 1, value1: 3 }), "1 / 3 complete");
  assert.equal(en("Add {label}"), "Add {label}");
  assert.equal(en("Add {label}", Object.create({ label: "inherited" })), "Add {label}");
  assert.equal(en("constructor"), "constructor");
  assert.equal(en("A diagnostic not in the catalog"), "A diagnostic not in the catalog");
});

test("structured validation and import progress keep diagnostic details unchanged", () => {
  assert.equal(translate("ja", "Reading tests/Problems.in (2/17)"), "読み込み中: tests/Problems.in（2/17）");
  assert.equal(translate("ja", "Title must be non-empty and at most 160 characters."), "タイトルは必須で、160文字以下にしてください。");
  assert.equal(translate("ja", "Missing Markdown file: lessons/Problems.md"), "Markdownファイルが見つかりません: lessons/Problems.md");
  assert.equal(translate("en", "Duplicate code cell id: 日本語-id"), "Duplicate code cell ID: 日本語-id");
});

test("every catalog entry has both locales and identical interpolation parameters", () => {
  const tokens = (text: string) => [...text.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]).sort();
  for (const [key, entry] of Object.entries(messages)) {
    assert.ok(entry.ja && entry.en, key);
    assert.equal(key, key.trim());
    assert.deepEqual(tokens(entry.ja), tokens(entry.en), key);
    assert.deepEqual(tokens(key), tokens(entry.en), key);
  }
});

function sourceFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const name = path.join(folder, entry.name);
    return entry.isDirectory() ? sourceFiles(name) : name.endsWith(".tsx") ? [name] : [];
  });
}

test("site UI literals use the translation catalog; authored content stays outside it", () => {
  const failures: string[] = [];
  const root = process.cwd();
  for (const file of [...sourceFiles(path.join(root, "app")), ...sourceFiles(path.join(root, "components"))]) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const fail = (node: ts.Node, message: string) => failures.push(`${path.relative(root, file)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${message}`);
    function visit(node: ts.Node) {
      if (ts.isJsxText(node) && /[\p{L}]/u.test(node.text)) {
        const parent = node.parent;
        const inCode = ts.isJsxElement(parent) && ["code", "pre"].includes(parent.openingElement.tagName.getText(source));
        const nativeLanguageNames = path.basename(file) === "language-switcher.tsx" && ["日本語", "English"].includes(node.text.trim());
        if (!inCode && !nativeLanguageNames) fail(node, `Untranslated JSX: ${node.text.trim()}`);
      }
      if (ts.isCallExpression(node) && node.expression.getText(source) === "t") {
        const key = node.arguments[0];
        if (key && ts.isStringLiteral(key) && !Object.hasOwn(messages, key.text.trim())) fail(node, `Missing catalog key: ${key.text}`);
      }
      if (ts.isJsxAttribute(node) && ["placeholder", "aria-label", "title", "alt"].includes(node.name.getText(source))) {
        if (node.initializer && ts.isStringLiteral(node.initializer) && /[\p{L}]/u.test(node.initializer.text)) fail(node, "Untranslated label attribute");
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  assert.deepEqual(failures, []);
});

test("dates use the selected locale and a consistent Japan timezone", () => {
  const date = "2026-10-10T00:23:00Z";
  assert.equal(formatDate(date, "ja"), "2026/10/10 09:23");
  assert.equal(formatDate(date, "en"), "10/10/2026, 09:23");
});
