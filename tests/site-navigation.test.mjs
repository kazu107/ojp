import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime");
const { PathnameContext } = require("next/dist/shared/lib/hooks-client-context.shared-runtime");
const { I18nProvider } = require("../components/i18n-provider.tsx");
const { SiteNavigation } = require("../components/site-navigation.tsx");
const router = { bfcacheId: "design-test", back() {}, forward() {}, push() {}, replace() {}, refresh() {}, prefetch() {} };
const render = (path, locale = "ja", permissions = {}) => React.createElement(AppRouterContext.Provider, { value: router },
  React.createElement(PathnameContext.Provider, { value: path },
    React.createElement(I18nProvider, { initialLocale: locale },
      React.createElement(SiteNavigation, { signedIn: true, isAdmin: true, canCreateProblem: true, ...permissions }, "controls"))));

test("current navigation is unique and recognizes nested pages in both locales", () => {
  for (const locale of ["ja", "en"]) for (const [path, href] of [["/", "/"], ["/problems/p1/edit", "/problems"], ["/learn/course/chapters/one", "/learn"], ["/submissions/s1", "/submissions"], ["/admin", "/admin"], ["/me", "/me"]]) {
    const html = renderToStaticMarkup(render(path, locale));
    const current = [...html.matchAll(/<a\b[^>]*aria-current="page"[^>]*>/g)];
    assert.equal(current.length, 1, `${locale} ${path}`);
    assert.ok(current[0][0].includes(`href="${href}"`));
    assert.ok(html.includes('href="#main-content"'));
    assert.ok(html.includes('aria-expanded="false"'));
  }
});

test("guest navigation omits account, admin and author utilities", () => {
  const html = renderToStaticMarkup(render("/", "en", { signedIn: false, isAdmin: false, canCreateProblem: false }));
  for (const path of ["/admin", "/me", "/review", "/problems/new"]) assert.ok(!html.includes(`href="${path}"`));
  for (const path of ["/problems", "/learn", "/contests", "/submissions", "/ratings"]) assert.ok(html.includes(`href="${path}"`));
});

test("problem authors retain create access without showing admin utilities", () => {
  const html = renderToStaticMarkup(render("/problems/new", "en", { isAdmin: false }));
  assert.ok(html.includes('href="/problems/new"'));
  assert.ok(html.includes('href="/review"'));
  assert.ok(!html.includes('href="/admin"'));
});
