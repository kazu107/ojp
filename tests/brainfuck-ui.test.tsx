import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { I18nProvider } from "../components/i18n-provider";
import { LearningMarkdown } from "../components/learning-markdown";

test("Brainfuck Markdown renders a runnable cell in both UI locales, not static code", () => {
  for (const locale of ["ja", "en"] as const) {
    const html = renderToStaticMarkup(
      <AppRouterContext.Provider
        value={{
          bfcacheId: "brainfuck-render-test",
          back() {},
          forward() {},
          push() {},
          replace() {},
          refresh() {},
          prefetch() {},
        }}
      >
        <I18nProvider initialLocale={locale}>
          <LearningMarkdown
            text={"```brainfuck run id=echo\n,[.,]\n```"}
            cells={{ echo: { stdin: "Hello\n", readOnly: true } }}
            storagePrefix="test:bf"
          />
        </I18nProvider>
      </AppRouterContext.Provider>,
    );
    assert.ok(html.includes('class="learning-code-cell"'));
    assert.ok(html.includes("Brainfuck"));
    assert.ok(
      html.includes(locale === "ja" ? "初期コードに戻す" : "Reset Code"),
      html,
    );
  }
});
