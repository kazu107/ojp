import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { I18nProvider } from "../components/i18n-provider";
import { SubmissionForm } from "../components/submission-form";
import { SUBMISSION_LANGUAGES } from "../lib/languages";

test("the submission selector exposes every runtime in Japanese and English", () => {
  for (const locale of ["ja", "en"] as const) {
    const html = renderToStaticMarkup(
      <AppRouterContext.Provider
        value={{
          bfcacheId: "language-selector-test",
          back() {},
          forward() {},
          push() {},
          replace() {},
          refresh() {},
          prefetch() {},
        }}
      >
        <I18nProvider initialLocale={locale}>
          <SubmissionForm problemId="test" />
        </I18nProvider>
      </AppRouterContext.Provider>,
    );
    for (const language of SUBMISSION_LANGUAGES)
      assert.ok(html.includes(`value="${language}"`), language);
    assert.ok(html.includes("C# (Mono)"));
    assert.ok(html.includes("Python (PyPy3)"));
  }
});
