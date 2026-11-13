import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { act, create } from "react-test-renderer";
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

test("mobile disclosure closes on Escape, navigation and pathname changes", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const oldDocument = globalThis.document;
  const oldSelf = globalThis.self;
  globalThis.self = globalThis;
  globalThis.document = { documentElement: { lang: "" } };
  let tree;
  let focused = 0;
  try {
    await act(async () => { tree = create(render("/problems"), { createNodeMock: element => element.props.className === "site-menu-toggle" ? { focus() { focused++; } } : null }); });
    const toggle = () => tree.root.findByProps({ className: "site-menu-toggle" });
    const isOpen = () => toggle().props["aria-expanded"];
    assert.equal(isOpen(), false);
    await act(async () => { toggle().props.onClick(); });
    assert.equal(isOpen(), true);
    await act(async () => { tree.root.findByType("header").props.onKeyDown({ key: "Escape" }); });
    assert.equal(isOpen(), false);
    assert.equal(focused, 1);
    await act(async () => { toggle().props.onClick(); });
    await act(async () => { tree.root.findAll(node => node.props.href === "/learn" && typeof node.type !== "string")[0].props.onClick(); });
    assert.equal(isOpen(), false);
    await act(async () => { toggle().props.onClick(); });
    await act(async () => { tree.update(render("/submissions")); });
    assert.equal(isOpen(), false);
    assert.equal(tree.root.findAllByType("a").find(a => a.props.href === "/submissions").props["aria-current"], "page");
    await act(async () => { tree.update(render("/problems")); });
    assert.equal(isOpen(), false, "Back navigation must not reopen the previous menu");
  } finally {
    if (tree) await act(async () => { tree.unmount(); });
    globalThis.document = oldDocument;
    globalThis.self = oldSelf;
  }
});
